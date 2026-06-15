{
  description = "OSIRIS — open-source OSINT situational-awareness dashboard (Next.js 16) + intel sidecar, packaged for NixOS";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";

  outputs = { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = lib.genAttrs systems;

      mkPackages = system:
        let
          pkgs = nixpkgs.legacyPackages.${system};

          # Strip build artifacts / VCS / committed node_modules from the source
          # tree so they neither bust the derivation hash nor bloat the store.
          srcFilter = root: lib.cleanSourceWith {
            src = root;
            filter = path: type:
              let base = baseNameOf path; in
              !(base == "node_modules"
                || base == ".next"
                || base == "result"
                || base == "flake.nix"
                || base == "flake.lock"
                || base == "nix" # the nix/ dir — module/example, not app source
                || lib.hasSuffix ".diff" base);
          };

          osiris = pkgs.buildNpmPackage {
            pname = "osiris";
            version = "0.1.0";
            src = srcFilter ./.;

            # Pinned to package-lock.json. Recompute after any dependency change:
            #   nix run nixpkgs#prefetch-npm-deps -- package-lock.json
            npmDepsHash = "sha256-HNxq/GloEyX32e3U/lliGXXCGKijaaP2uJZf5Kik2co=";

            # autoPatchelfHook fixes the ELF interpreter/RPATH on sharp's prebuilt
            # native image optimiser so it runs on NixOS (no /lib64 ld-linux).
            nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.makeWrapper ];
            buildInputs = [ pkgs.stdenv.cc.cc.lib ]; # libstdc++ / libgcc_s for sharp

            NEXT_TELEMETRY_DISABLED = "1";

            # package.json "build" → `next build` (output: 'standalone' in next.config.ts)
            installPhase = ''
              runHook preInstall

              mkdir -p $out/share/osiris
              cp -r .next/standalone/. $out/share/osiris/
              mkdir -p $out/share/osiris/.next
              cp -r .next/static $out/share/osiris/.next/static
              [ -d public ] && cp -r public $out/share/osiris/public

              # Next's standalone tracer can drop the native image optimiser;
              # make sure sharp and its prebuilt libvips land in the output.
              if [ ! -e $out/share/osiris/node_modules/sharp ]; then
                cp -r node_modules/sharp $out/share/osiris/node_modules/ 2>/dev/null || true
                cp -r node_modules/@img  $out/share/osiris/node_modules/ 2>/dev/null || true
              fi

              # We build against glibc; sharp's musl variants get bundled too but
              # can't be patchelf'd here (no libc.musl). sharp loads the glibc
              # binary at runtime, so the musl ones are dead weight — drop them.
              rm -rf $out/share/osiris/node_modules/@img/*musl* 2>/dev/null || true

              makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/osiris \
                --add-flags $out/share/osiris/server.js \
                --chdir $out/share/osiris \
                --set-default PORT 3000 \
                --set-default HOSTNAME 127.0.0.1 \
                --set-default NODE_ENV production

              runHook postInstall
            '';

            meta = {
              description = "OSIRIS OSINT situational-awareness dashboard (Next.js standalone)";
              homepage = "https://github.com/tellmemoree/osiris-Ukraine";
              license = lib.licenses.mit;
              mainProgram = "osiris";
              platforms = systems;
            };
          };

          osiris-intel = pkgs.buildNpmPackage {
            pname = "osiris-intel";
            version = "1.0.0";
            src = srcFilter ./intel;

            # nix run nixpkgs#prefetch-npm-deps -- intel/package-lock.json
            npmDepsHash = "sha256-Ekcq1xHgiYsGbFJLPzuQltOZ4k5bR7UyiJQt/EL0crw=";
            dontNpmBuild = true; # pure-JS Express sidecar, nothing to compile

            nativeBuildInputs = [ pkgs.makeWrapper ];

            installPhase = ''
              runHook preInstall
              mkdir -p $out/share/osiris-intel
              cp -r server.js node_modules package.json $out/share/osiris-intel/
              makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/osiris-intel \
                --add-flags $out/share/osiris-intel/server.js \
                --chdir $out/share/osiris-intel \
                --set-default INTEL_PORT 4000
              runHook postInstall
            '';

            meta = {
              description = "OSIRIS intelligence-layer sidecar (Express)";
              license = lib.licenses.mit;
              mainProgram = "osiris-intel";
              platforms = systems;
            };
          };
        in {
          inherit osiris osiris-intel;
          default = osiris;
        };
    in {
      packages = forAllSystems mkPackages;

      nixosModules.osiris = import ./nix/module.nix self;
      nixosModules.default = self.nixosModules.osiris;

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = lib.getExe self.packages.${system}.osiris;
        };
        intel = {
          type = "app";
          program = lib.getExe self.packages.${system}.osiris-intel;
        };
      });

      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system}; in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_22 pkgs.prefetch-npm-deps ];
          };
        });

      # `nix flake check` / `nix build .#checks.x86_64-linux.vm-boot`
      # Boots a VM with the module, starts the service under the hardened
      # systemd sandbox, and curls the app directly and through nginx.
      # (Intel sidecar is left off here — it fetches OpenSanctions on boot and
      # the test VM has no network; it's smoke-tested separately.)
      checks = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system}; in
        lib.optionalAttrs (system == "x86_64-linux") {
          vm-boot = pkgs.testers.runNixOSTest {
            name = "osiris-vm-boot";
            nodes.machine = { ... }: {
              imports = [ self.nixosModules.osiris ];
              services.osiris = {
                enable = true;
                nginx = {
                  enable = true;
                  hostName = "osiris.local";
                };
              };
              virtualisation.memorySize = 2048;
              virtualisation.diskSize = 4096;
            };
            testScript = ''
              machine.wait_for_unit("osiris.service")
              machine.wait_for_open_port(3000)
              machine.succeed("curl -sf http://127.0.0.1:3000/api/health | grep -q operational")

              machine.wait_for_unit("nginx.service")
              machine.wait_for_open_port(80)
              machine.succeed("curl -sf -H 'Host: osiris.local' http://127.0.0.1/api/health | grep -q operational")
              machine.succeed("curl -sf -H 'Host: osiris.local' http://127.0.0.1/ -o /dev/null")
            '';
          };
        });

      # Example host wiring the module together. Also acts as an eval-time
      # smoke test for the module's option types. For a real DO droplet,
      # replace the placeholder hardware/boot bits — see nix/do-example.nix.
      nixosConfigurations.osiris-do = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [ self.nixosModules.osiris ./nix/do-example.nix ];
      };
    };
}
