export class KeyPair {
  constructor(public publicKey:string, private privateKey:string) {}
}

export class KeyBundle {
  constructor(
    public identityKey:String,
    public signedPreKey:String,
    public signedPreKeySignature:String,
    public oneTimePreKeys: string[] = []
  ) {}
}