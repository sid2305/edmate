# Edmate dev container image. Every version is pinned; bump them on purpose, in one PR.
# Base: devcontainers/base 3.0.10 on Ubuntu 24.04 (noble), pinned by digest. It already ships git, curl and jq.
FROM mcr.microsoft.com/devcontainers/base:3.0.10-noble@sha256:21e9e3275736cb3bc33a2904b279a2ab292c51fedd53c2963463627d4586c3e6

# Python 3 + PyYAML for the secret scan and the repo's Python tools (board, merge gate).
# python3-yaml is pinned to the noble release-pocket build, which the archive keeps for good.
# jq is pinned by the base image digest (1.7.1-3ubuntu0.24.04.2); python3 comes from noble.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        python3 \
        python3-yaml=6.0.1-2build2 \
    && rm -rf /var/lib/apt/lists/*
