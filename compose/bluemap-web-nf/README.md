# bluemap-web-nf: the NeoForge map web server (NF-BM-3)

A read-only static Caddy that serves the BlueMap tiles of the NeoForge shard on loopback port 8110. It is not part of
`compose/nf-live.yml` (that file belongs to geldar-neoforge). The owner of the NeoForge overlay places the service below
as its own overlay file, next to `Caddyfile` in this folder (the bind path is relative to `compose/`).

What the container can see, stated plainly:

- **Only the subpath `bluemap/web` of the volume `neoforge-data` is mounted, read only, at `/srv`.** The container never
  mounts `/data`: the world, `server.properties` (RCON password), the mod jars and the mod configs are not visible to it.
- The `Caddyfile` is a read-only bind. Nothing else is mounted.
- It serves GET and HEAD only. `/maps/<map>/live` and anything below it return 404, even if a file exists in the webroot.
  There is no reverse proxy and no custom script or style on this map.
- The directory `bluemap/web` must exist before this container starts. The service waits for the `neoforge` service to be
  healthy, and nothing is created by hand.

The snippet uses placeholders only (no hostnames or secrets). The loopback edge (`deploy/caddy/map-neoforge.caddy`, a
later packet) is the only way in from the host.

```yaml
services:
  bluemap-web-nf:
    # Budget: 0.25 CPU, 64m (no swap, 64 pids), as bluemap-web on Paper.
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 64m
          pids: 64
    memswap_limit: 64m
    pids_limit: 64
    # The same pinned digest as compose/colo.yml bluemap-web.
    image: caddy@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb
    command: ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
    environment:
      # Caddy writes its autosave and state under these; the root filesystem is read only, /tmp is a tmpfs.
      XDG_CONFIG_HOME: /tmp/config
      XDG_DATA_HOME: /tmp/data
    volumes:
      # Only the bluemap/web subpath of the NeoForge data volume, read only. Never the volume root. The directory must exist at start.
      - type: volume
        source: neoforge-data
        target: /srv
        read_only: true
        volume:
          subpath: bluemap/web
      - ./bluemap-web-nf/Caddyfile:/etc/caddy/Caddyfile:ro
    ports:
      # The loopback map port. Literal: the loopback rule rejects interpolation.
      - "127.0.0.1:8110:8110"
    # Must match the neoforge service's uid:gid (NF_SERVICE_UID, NF_SERVICE_GID; the node runs as 1001) so it can read
    # what BlueMap writes under bluemap/web. Same variables as compose/nf-live.yml and deploy/nf-deploy.sh.
    user: "${NF_SERVICE_UID:-1000}:${NF_SERVICE_GID:-${NF_SERVICE_UID:-1000}}"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt: ["no-new-privileges:true"]
    depends_on:
      neoforge:
        condition: service_healthy
    restart: unless-stopped
```
