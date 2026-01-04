{
  inputs.nixpkgs.url = "github:Nixos/nixpkgs/nixos-unstable";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = import nixpkgs {inherit system;};
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [nodejs pnpm_10 biome];
        };
        packages = rec {
          kokyangwuti = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "kokyangwuti";
            inherit (builtins.fromJSON (builtins.readFile ./package.json)) version;

            src = ./.;

            nativeBuildInputs = with pkgs; [
              nodejs
              pnpmConfigHook
              pnpm_10
            ];

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              hash = "sha256-/tJRgFLEdEkAFohAChXFTf8VKqfCyhL+yGOtfZXCmVQ=";
              fetcherVersion = 3;
            };

            buildPhase = ''
              pnpm run build
            '';

            installPhase = ''
              cp -r dist $out
            '';
          });
          default = kokyangwuti;
        };
      }
    );
}
