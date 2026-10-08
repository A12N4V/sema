{
  description = "sema dev shell — Node + Python toolchains only; npm/uv still manage actual deps in place";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.python312
            pkgs.uv
          ];
          shellHook = ''
            echo "sema devShell: node $(node -v), python $(python3 --version)"
            echo "frontend: cd frontend && npm install && npm run dev"
            echo "backend:  cd backend && uv sync"
          '';
        };
      });
}
