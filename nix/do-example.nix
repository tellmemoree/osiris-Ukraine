# Example NixOS host for a DigitalOcean droplet running OSIRIS.
#
# This evaluates as-is (so `nix flake check` can type-check the module), but
# the boot/filesystem/network bits below are PLACEHOLDERS. On a real droplet:
#
#   1. Provision NixOS (e.g. via nixos-infect, or DO's NixOS image).
#   2. Replace the boot.loader / fileSystems block here with the droplet's
#      generated /etc/nixos/hardware-configuration.nix (import it instead).
#   3. Drop your SSH key into users.users.root.openssh.authorizedKeys.keys.
#   4. Set services.osiris.nginx.hostName to your domain and flip enableACME on
#      once DNS points at the droplet.
#   5. Put secrets in /run/secrets/osiris.env (or use sops/agenix) and point
#      services.osiris.environmentFile at it.
{ lib, modulesPath, ... }:
{
  imports = [
    # On the droplet, prefer the generated hardware config + DO image module:
    #   (modulesPath + "/virtualisation/digital-ocean-config.nix")
    # and delete the placeholder boot/fs block below.
  ];

  # ── Placeholder boot + filesystem (replace with hardware-configuration.nix) ──
  boot.loader.grub.device = lib.mkDefault "/dev/vda";
  fileSystems."/" = lib.mkDefault {
    device = "/dev/vda1";
    fsType = "ext4";
  };
  swapDevices = [ ];

  # ── Networking ──
  networking.hostName = "osiris";
  networking.useDHCP = lib.mkDefault true;

  # ── Access ──
  services.openssh.enable = true;
  users.users.root.openssh.authorizedKeys.keys = [
    # "ssh-ed25519 AAAA... you@host"
  ];

  # ── OSIRIS ──
  services.osiris = {
    enable = true;
    intel.enable = true;
    openFirewall = true;

    # Secrets live outside the Nix store. Create the file on the droplet, e.g.:
    #   SHODAN_API_KEY=...
    #   CENSYS_API_ID=censys_...
    #   TELEGRAM_BOT_TOKEN=...
    #   TELEGRAM_CHAT_ID=...
    #   GITHUB_WEBHOOK_SECRET=...
    # environmentFile = "/run/secrets/osiris.env";

    nginx = {
      enable = true;
      hostName = "osiris.example.com";
      enableACME = false; # set true (and accept the ACME terms below) once DNS resolves
    };
  };

  # Required if you enable ACME/Let's Encrypt above:
  # security.acme = {
  #   acceptTerms = true;
  #   defaults.email = "you@example.com";
  # };

  system.stateVersion = "25.05";
}
