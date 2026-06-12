# NixOS module for OSIRIS. Imported from the flake as `nixosModules.osiris`.
# `self` is the flake's own outputs, used to pull the default packages.
self:
{ config, lib, pkgs, ... }:

let
  cfg = config.services.osiris;
  inherit (lib) mkOption mkEnableOption mkIf mkMerge types optionalAttrs;
  pkgsFor = self.packages.${pkgs.stdenv.hostPlatform.system};
in
{
  options.services.osiris = {
    enable = mkEnableOption "OSIRIS OSINT situational-awareness dashboard";

    package = mkOption {
      type = types.package;
      default = pkgsFor.osiris;
      defaultText = lib.literalExpression "osiris flake package";
      description = "The OSIRIS (Next.js) package to run.";
    };

    listenAddress = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = ''
        Address the Next.js server binds. Keep the loopback default and put a
        reverse proxy in front (see {option}`services.osiris.nginx`). Set
        `0.0.0.0` only if you want the app directly reachable.
      '';
    };

    port = mkOption {
      type = types.port;
      default = 3000;
      description = ''
        Port the Next.js server listens on. Leave this at 3000: two API routes
        (`/api/scm-suppliers`, `/api/markets`) make hardcoded server-side calls
        to `http://127.0.0.1:3000`, so changing the port silently breaks them.
      '';
    };

    environmentFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/run/secrets/osiris.env";
      description = ''
        Path to an EnvironmentFile (KEY=value lines) holding secrets, kept out
        of the world-readable Nix store. Keys the osiris-Ukraine branch reads:
        `CENSYS_API_ID`, `CENSYS_API_SECRET`, `SHODAN_API_KEY`,
        `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `WINDY_WEBCAM_KEY`,
        `AIS_API_KEY`, `GITHUB_WEBHOOK_SECRET`, `SDK_INGEST_KEY`, and the
        optional `SHADOW_FLEET_SOURCE_URL` override. Every data feed works
        keyless; these only raise rate limits / enable extra sources.
      '';
    };

    extraEnvironment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = { OSIRIS_TELEGRAM_CHANNELS = "osintdefender,nexta_live"; };
      description = "Extra non-secret environment variables for the service.";
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open the firewall. With nginx: ports 80/443. Without: the app port.";
    };

    intel = {
      enable = mkEnableOption "the OSIRIS intel sidecar (entity-graph resolver)";
      package = mkOption {
        type = types.package;
        default = pkgsFor.osiris-intel;
        defaultText = lib.literalExpression "osiris-intel flake package";
        description = "The OSIRIS intel sidecar package.";
      };
      port = mkOption {
        type = types.port;
        default = 4000;
        description = "Loopback port for the intel sidecar.";
      };
    };

    nginx = {
      enable = mkEnableOption "an nginx reverse proxy in front of OSIRIS";
      hostName = mkOption {
        type = types.str;
        example = "osiris.example.com";
        description = "Virtual host / server name for the reverse proxy.";
      };
      enableACME = mkOption {
        type = types.bool;
        default = false;
        description = "Obtain a Let's Encrypt cert and force HTTPS for {option}`hostName`.";
      };
    };
  };

  config = mkIf cfg.enable (mkMerge [
    {
      # Warn instead of hard-failing: the app technically runs on another port,
      # it just loses the two self-referential routes.
      warnings = lib.optional (cfg.port != 3000)
        "services.osiris.port is ${toString cfg.port}, not 3000 — /api/scm-suppliers and /api/markets hardcode http://127.0.0.1:3000 and will fail.";

      systemd.services.osiris = {
        description = "OSIRIS OSINT dashboard (Next.js)";
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" ] ++ lib.optional cfg.intel.enable "osiris-intel.service";
        wants = [ "network-online.target" ];

        environment = {
          NODE_ENV = "production";
          PORT = toString cfg.port;
          HOSTNAME = cfg.listenAddress;
          NEXT_TELEMETRY_DISABLED = "1";
          NODE_OPTIONS = "--dns-result-order=ipv4first";
        } // optionalAttrs cfg.intel.enable {
          INTEL_URL = "http://127.0.0.1:${toString cfg.intel.port}";
        } // cfg.extraEnvironment;

        serviceConfig = {
          ExecStart = lib.getExe cfg.package;
          Restart = "on-failure";
          RestartSec = 5;
          EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;

          # Hardening — the app is stateless (in-memory caches only).
          DynamicUser = true;
          NoNewPrivileges = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          PrivateTmp = true;
          PrivateDevices = true;
          ProtectKernelTunables = true;
          ProtectKernelModules = true;
          ProtectControlGroups = true;
          RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
          RestrictNamespaces = true;
          LockPersonality = true;
          MemoryDenyWriteExecute = false; # V8 JIT needs W^X off
          SystemCallFilter = [ "@system-service" ];
          SystemCallErrorNumber = "EPERM";
        };
      };
    }

    (mkIf cfg.intel.enable {
      systemd.services.osiris-intel = {
        description = "OSIRIS intel sidecar (entity-graph resolver)";
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" ];
        wants = [ "network-online.target" ];
        environment.INTEL_PORT = toString cfg.intel.port;
        serviceConfig = {
          ExecStart = lib.getExe cfg.intel.package;
          Restart = "on-failure";
          RestartSec = 5;
          DynamicUser = true;
          NoNewPrivileges = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          PrivateTmp = true;
          PrivateDevices = true;
          RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
          SystemCallFilter = [ "@system-service" ];
        };
      };
    })

    (mkIf cfg.nginx.enable {
      services.nginx = {
        enable = true;
        recommendedProxySettings = true;
        recommendedOptimisation = true;
        recommendedGzipSettings = true;
        virtualHosts.${cfg.nginx.hostName} = {
          forceSSL = cfg.nginx.enableACME;
          enableACME = cfg.nginx.enableACME;
          locations."/" = {
            proxyPass = "http://${cfg.listenAddress}:${toString cfg.port}";
            proxyWebsockets = true;
            extraConfig = ''
              proxy_read_timeout 300s;
              client_max_body_size 10m;
            '';
          };
        };
      };
    })

    (mkIf cfg.openFirewall {
      networking.firewall.allowedTCPPorts =
        if cfg.nginx.enable then [ 80 443 ] else [ cfg.port ];
    })
  ]);
}
