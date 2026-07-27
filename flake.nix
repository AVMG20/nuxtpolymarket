{
  description = "Nuxtpolymarket development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          python = pkgs.python3.withPackages (packages: [
            packages.pyyaml
          ]);
        in {
          default = pkgs.mkShell {
            packages = [
              pkgs.bun
              pkgs.postgresql
              python
            ];

            shellHook = ''
              echo "Nuxtpolymarket shell: Bun, PostgreSQL, Python, and PyYAML are available."
            '';
          };
        });
    };
}
