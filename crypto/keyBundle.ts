
export interface KeyBundle {
  userId: string;    
  identityKey: Buffer;   
  signedPreKey: Buffer;
  signature: Buffer;      
  oneTimePreKeys: { keyId: number, publicKey: Buffer }[]; 
}