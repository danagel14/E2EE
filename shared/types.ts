


export class KeyPair {
  constructor(public publicKey: Uint8Array, public privateKey: Uint8Array) { }
}

export class KeyBundle {
  constructor(
    public identityKey: Uint8Array,
    public signedPreKey: Uint8Array,
    public signedPreKeySignature: Uint8Array,
    public oneTimePreKeys: Uint8Array[] = []
  ) { }
}