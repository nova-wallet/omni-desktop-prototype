import React, { FormEvent, useState } from 'react';
import { format } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dialog } from '@headlessui/react';
import { useHistory } from 'react-router';
import { useMatrix } from '../Providers/MatrixProvider';
import { Routes, withId } from '../../../common/constants';
import useToggle from '../../hooks/toggle';
import { db } from '../../db/db';
import {
  Account,
  BooleanValue,
  Contact,
  CryptoType,
  Notification,
} from '../../db/types';
import { OmniExtras } from '../../modules/types';
import {
  createMultisigWalletPayload,
  formatAddress,
  toPublicKey,
  isMultisig,
} from '../../utils/account';
import DialogContent from '../../ui/DialogContent';
import InputText from '../../ui/Input';
import Button from '../../ui/Button';
import NotifyItem from './NotifyItem';

type Props = {
  notif: Notification;
};

const InviteNotif: React.FC<Props> = ({ notif }) => {
  const history = useHistory();
  const { matrix } = useMatrix();
  const account = (notif.content as OmniExtras).mst_account;

  const [isDialogOpen, toggleDialogOpen] = useToggle(false);
  const [walletName, setWalletName] = useState('');

  const contacts = useLiveQuery(() => db.contacts.toArray());
  const wallets = useLiveQuery(() => db.wallets.toArray());
  const multisigWallets = useLiveQuery(() =>
    db.wallets.where({ isMultisig: BooleanValue.TRUE }).toArray(),
  );

  const handleReadInvite = async () => {
    const mstAccountId = multisigWallets?.find((m) =>
      m.mainAccounts.some((a) => a.accountId === account.address),
    )?.id;

    if (mstAccountId) {
      history.push(withId(Routes.EDIT_MULTISIG_WALLET, mstAccountId));
    } else {
      setWalletName(account.accountName);
      toggleDialogOpen();
    }
  };

  const handleUnreadInvite = () => {
    const mstAccountId = multisigWallets?.find((m) =>
      m.mainAccounts.some((a) => a.accountId === account.address),
    )?.id;
    if (mstAccountId) {
      db.wallets.update(mstAccountId, {
        matrixRoomId: notif.roomId,
      });
    }

    db.mxNotifications.update(notif, {
      isRead: BooleanValue.TRUE,
    });
    setWalletName(account.accountName);
    toggleDialogOpen();
  };

  // TODO: enable after implementing Parity Signer room signature
  // const checkIsInviteValid = (
  //   roomId: string,
  //   { invite, mst_account }: OmniExtras,
  // ) => {
  //   const keyring = new Keyring();
  //   const inviter = keyring.addFromAddress(mst_account.address);
  //
  //   const message = stringToU8a(`${mst_account.address}${roomId}`);
  //   const signature = stringToU8a(invite.signature);
  //   return inviter.verify(message, signature, invite.public_key);
  // };

  const onDetailsClick = () => {
    // TODO: enable after implementing Parity Signer room signature
    // const extras = notif.content as OmniExtras;
    // if (!checkIsInviteValid(notif.roomId, extras)) {
    //   console.warn('Invite is invalid');
    //   return;
    // }

    if (notif.isRead) {
      handleReadInvite();
    } else {
      handleUnreadInvite();
    }
  };

  const createMstAccount = async () => {
    const isSamePublicKey = (
      contact: { mainAccounts: Account[] },
      address: string,
    ) => contact.mainAccounts[0]?.publicKey === toPublicKey(address);

    const walletContacts = account.signatories.map((signatory) => {
      const address = formatAddress(signatory);

      const matchInContacts = contacts?.find((c) =>
        isSamePublicKey(c, address),
      );
      const matchInWallets = wallets?.find(
        (wallet) => !isMultisig(wallet) && isSamePublicKey(wallet, address),
      );

      if (matchInContacts) return matchInContacts;
      if (matchInWallets) return matchInWallets;

      return {
        secureProtocolId: '',
        chainAccounts: [],
        mainAccounts: [
          {
            accountId: address,
            publicKey: toPublicKey(address),
            cryptoType: CryptoType.ED25519,
          },
        ],
      };
    });

    const { payload } = createMultisigWalletPayload({
      walletName,
      matrixRoomId: notif.roomId,
      threshold: account.threshold,
      addresses: account.signatories,
      contacts: walletContacts as Contact[],
    });

    const mstAccountId = await db.wallets.add(payload);
    history.push(withId(Routes.EDIT_MULTISIG_WALLET, mstAccountId));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      // Could try to join deleted room
      await matrix.joinRoom(notif.roomId);
      await createMstAccount();
    } catch (error) {
      console.warn(error);
    }
  };

  return (
    <>
      <NotifyItem
        title="Invitation to Multisig account"
        description={`You were invited to ${account.accountName} by ${notif.sender}`}
        date={format(notif.date, 'HH:mm:ss dd MMM, yyyy')}
        address={account.address}
        isRead={Boolean(notif.isRead)}
        onClick={onDetailsClick}
      />

      <Dialog
        as="div"
        className="relative z-10"
        open={isDialogOpen}
        onClose={toggleDialogOpen}
      >
        <DialogContent>
          <Dialog.Title as="h3" className="font-light text-xl">
            Invitation to Multisig account
          </Dialog.Title>
          <div className="mt-2">Choose name for your MST account?</div>

          <form onSubmit={onSubmit}>
            <InputText
              className="w-full mt-4"
              label="Wallet name"
              placeholder="Wallet name"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
            />
            <div className="mt-2 flex justify-between">
              <Button className="max-w-min" onClick={toggleDialogOpen}>
                Cancel
              </Button>
              <Button
                className="max-w-min"
                type="submit"
                disabled={!walletName}
              >
                Submit
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InviteNotif;
