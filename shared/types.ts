

export class KeyPair {
  constructor(public publicKey: Buffer, public privateKey: Buffer) { }
}

export class KeyBundle {
  constructor(
    public identityKey: Buffer,
    public signedPreKey: Buffer,
    public signedPreKeySignature: Buffer,
    public oneTimePreKeys: Buffer[] = []
  ) { }
}