```sh
$ nix eval --raw nixpkgs#hello
/nix/store/kwmqk7ygvhypxadsdaai27gl6qfxv7za-hello-2.12.1

$ curl http://cache.nixos.org/kwmqk7ygvhypxadsdaai27gl6qfxv7za.narinfo
StorePath: /nix/store/kwmqk7ygvhypxadsdaai27gl6qfxv7za-hello-2.12.1
URL: nar/0dri9ygy83fbjmd1djlq2dfkkirx3qj0gzilmn1s85phz1mhs11p.nar.xz
Compression: xz
FileHash: sha256:0dri9ygy83fbjmd1djlq2dfkkirx3qj0gzilmn1s85phz1mhs11p
FileSize: 50364
NarHash: sha256:0xg8clvk961g26gwsp6zryakv5bqvkq8c9dcfnswvh51lqf5k36c
NarSize: 226560
References: kwmqk7ygvhypxadsdaai27gl6qfxv7za-hello-2.12.1 m71p7f0nymb19yn1dascklyya2i96jfw-glibc-2.39-52
Deriver: fqs92lzychkm6p37j7fnj4d65nq9fzla-hello-2.12.1.drv
Sig: cache.nixos.org-1:pSMYjCumz0gqC46TOfG7fGE8uWolJ16UVX1Fpxpj5XiETTnq8Zsv2JRlPnx1ZV2WsO6f6rT6Jfi+aaWtiJTOAQ==

# this sig is ed25519, supported by webcrypto in node/deno
# ref: https://github.com/nix-community/go-nix/blob/main/pkg/narinfo/signature/public_key.go

$ curl http://cache.nixos.org/m71p7f0nymb19yn1dascklyya2i96jfw.narinfo
StorePath: /nix/store/m71p7f0nymb19yn1dascklyya2i96jfw-glibc-2.39-52
...

$ curl http://cache.nixos.org/kwmqk7ygvhypxadsdaai27gl6qfxv7za.ls
# binary data

$ curl http://cache.nixos.org/m71p7f0nymb19yn1dascklyya2i96jfw.ls --compressed
{"root":{"entries":{"etc":{"entries":{"rpc":{"narOffset":368,"size":1634,"type":"regular"}},...
# provides the metadata of each file, plus its offsets into the nar
```

- [ ] binary substituter
  - [ ] netrc
- [ ] store abstraction
  - [ ] oci registry?
- [ ] chroot execution?
  - ref: https://github.com/nix-community/nix-user-chroot
  - ref: https://github.com/DavHau/nix-portable
  - ref: https://github.com/matthewbauer/nix-bundle
  - rootless: likely with bwrap
  - rootful: `mount --bind` + chroot
  - other platforms?
- [ ] generate drvs
- [ ] remote builder wire protocol
  - [ ] client
  - [ ] server?
    - maybe defer to RBE?
