import Dexie, { Table } from 'dexie';
import {
  Chain,
  ChainConnection,
  Contact,
  Credential,
  MultisigWallet,
  Notification,
  Transaction,
  Wallet,
} from './types';

export class OmniDexie extends Dexie {
  wallets!: Table<Wallet | MultisigWallet>;

  chains!: Table<Chain>;

  connections!: Table<ChainConnection>;

  contacts!: Table<Contact>;

  transactions!: Table<Transaction>;

  mxCredentials!: Table<Credential>;

  mxNotifications!: Table<Notification>;

  constructor() {
    super('omniDatabase');
    this.version(61).stores({
      wallets: '++id,name,isMultisig',
      chains: '++id,&chainId,parentId,name,activeType',
      connections: '++id,&chainId,activeType',
      contacts: '++id,name,secureProtocolId',
      transactions: '++id,chainId,address,type,status,data.callHash,data.salt',
      mxCredentials: '++id,userId,username,isLoggedIn',
      mxNotifications: '++id,sender,client',
    });
  }
}

export const db = new OmniDexie();
