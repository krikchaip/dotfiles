# One image for both E2E services: `client` runs the tests in tmux, and
# `remote` runs sshd for the remote-machine test.
# debian:trixie-slim, pinned to its multi-platform index digest. To update it:
#   docker buildx imagetools inspect debian:trixie-slim
FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4

# `file` is for yazi, in the image preview tests: yazi finds MIME types with it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl file git openssh-client openssh-server procps python3 tmux \
    && rm -rf /var/lib/apt/lists/*

# Pinned Herdr release, checked against its SHA-256 sum.
ARG HERDR_VERSION=v0.9.5
RUN set -eu; \
    arch=$(uname -m); \
    case "$arch" in \
        aarch64) sum=17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c ;; \
        x86_64) sum=14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d ;; \
        *) echo "no Herdr build for $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/herdr \
        "https://github.com/herdrdev/herdr/releases/download/$HERDR_VERSION/herdr-linux-$arch"; \
    echo "$sum  /usr/local/bin/herdr" | sha256sum -c -; \
    chmod 755 /usr/local/bin/herdr

# Pinned yazi release, for the image preview tests only, checked against its SHA-256 sum.
ARG YAZI_VERSION=v26.9.1
RUN set -eu; \
    arch=$(uname -m); \
    case "$arch" in \
        aarch64) sum=02807f08d6b589b65b7516a4e259d83f5995d7a23bb12b3a155141385b370b3a ;; \
        x86_64) sum=a02fe91d3304294048c681f010f1100856872a4e98ecf6927328e888d40a6ad2 ;; \
        *) echo "no yazi build for $arch" >&2; exit 1 ;; \
    esac; \
    name="yazi-$arch-unknown-linux-gnu"; \
    curl -fsSL -o /tmp/yazi.zip \
        "https://github.com/sxyazi/yazi/releases/download/$YAZI_VERSION/$name.zip"; \
    echo "$sum  /tmp/yazi.zip" | sha256sum -c -; \
    python3 -m zipfile -e /tmp/yazi.zip /tmp/yazi; \
    install -m 755 "/tmp/yazi/$name/yazi" "/tmp/yazi/$name/ya" /usr/local/bin/; \
    rm -rf /tmp/yazi /tmp/yazi.zip

# Both services share one SSH user key and one host key, so the client trusts remote.
RUN useradd -m -s /bin/bash tester && mkdir -p /run/sshd && ssh-keygen -A
USER tester
RUN mkdir -m 700 ~/.ssh \
    && ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/id_ed25519 \
    && cp ~/.ssh/id_ed25519.pub ~/.ssh/authorized_keys \
    && printf 'Host remote\n    StrictHostKeyChecking accept-new\n' > ~/.ssh/config
USER root

ENV LANG=C.UTF-8
