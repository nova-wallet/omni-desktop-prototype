import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Controller, SubmitHandler, useForm } from 'react-hook-form';
import { Dialog } from '@headlessui/react';
import { useSetRecoilState } from 'recoil';
import Button from '../../ui/Button';
import InputText from '../../ui/Input';
import { Contact, MultisigWallet } from '../../db/types';
import { db } from '../../db/db';
import Card from '../../ui/Card';
import Checkbox from '../../ui/Checkbox';
import Address from '../../ui/Address';
import DialogContent from '../../ui/DialogContent';
import useToggle from '../../hooks/toggle';
import { Routes } from '../../../common/constants';
import { useMatrix } from '../Providers/MatrixProvider';
import {
  createMultisigWalletPayload,
  isSameAccount,
  isMultisig,
  combinedContacts,
} from '../../utils/account';
import { RoomParams } from '../../modules/types';
import { selectedWalletsState } from '../../store/selectedWallets';

type DialogTypes = 'forget' | 'room' | 'mst' | 'create';

const DEFAULT_THRESHOLD = '2';

const DIALOG_CONTENT: Record<
  DialogTypes,
  {
    title: string;
    subtitle: string;
    buttons: (onToggle: () => void, onForget: () => void) => ReactNode;
  }
> = {
  mst: {
    title: 'MST account',
    subtitle: 'This account already exists',
    buttons: (onToggle) => (
      <div className="mt-2 flex justify-center">
        <Button className="max-w-min" onClick={onToggle}>
          OK
        </Button>
      </div>
    ),
  },
  room: {
    title: 'Room is not created',
    subtitle: "MST account doesn't include your wallet",
    buttons: (onToggle) => (
      <div className="mt-2 flex justify-center">
        <Button className="max-w-min" onClick={onToggle}>
          OK
        </Button>
      </div>
    ),
  },
  forget: {
    title: 'Forget wallet',
    subtitle: 'Are you sure you want to forget this wallet?',
    buttons: (onToggle, onForget) => (
      <div className="mt-2 flex justify-between">
        <Button className="max-w-min" onClick={onToggle}>
          Cancel
        </Button>
        <Button className="max-w-min" onClick={onForget}>
          Forget
        </Button>
      </div>
    ),
  },
  create: {
    title: 'Room error',
    subtitle:
      'There was an error creating your room, check your connection and try again.',
    buttons: (onToggle) => (
      <div className="mt-2 flex justify-between">
        <Button className="max-w-min" onClick={onToggle}>
          OK
        </Button>
      </div>
    ),
  },
};

type MultisigWalletForm = {
  walletName: string;
  threshold: string;
};

type MstRoom = Partial<RoomParams & { sign: string }>;

const ManageMultisigWallet: React.FC = () => {
  const history = useHistory();
  const { matrix } = useMatrix();

  const mstRoom = useRef<MstRoom>();
  const mstWallet = useRef<MultisigWallet>();

  const { id } = useParams<{ id: string }>();
  const [wallet, setWallet] = useState<MultisigWallet>();
  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([]);
  const [dialogType, setDialogType] = useState<DialogTypes>('mst');
  const [isRoomCreating, setIsRoomCreating] = useState(false);

  const [isDialogOpen, toggleDialogOpen] = useToggle(false);
  const setSelectedWallets = useSetRecoilState(selectedWalletsState);

  const contacts = useLiveQuery(() => db.contacts.toArray()) || [];
  const wallets = useLiveQuery(() => db.wallets.toArray());

  useEffect(() => {
    const getWallet = async () => {
      const multisigWallet = await db.wallets.get(Number(id));
      setWallet(() => multisigWallet as MultisigWallet);
    };

    if (id) {
      getWallet();
    }
  }, [id]);

  const {
    handleSubmit,
    control,
    reset,
    trigger,
    formState: { isValid },
  } = useForm<MultisigWalletForm>({
    mode: 'onChange',
    defaultValues: {
      walletName: '',
      threshold: DEFAULT_THRESHOLD,
    },
  });

  useEffect(() => {
    reset({
      walletName: wallet?.name || '',
      threshold: wallet?.threshold || DEFAULT_THRESHOLD,
    });
  }, [wallet, reset]);

  useEffect(() => {
    trigger('threshold');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContacts.length]);

  const updateMultisigWallet = (
    multisigWallet: MultisigWallet,
    name: string,
  ) => {
    db.wallets.put({ ...multisigWallet, name: name.trim() });
  };

  const openDialogWithType = (type: DialogTypes) => {
    setDialogType(type);
    toggleDialogOpen();
  };

  const cancelRoomCreation = () => {
    if (!mstRoom.current?.roomId) return;

    matrix.cancelRoomCreation(mstRoom.current?.roomId);
  };

  const finishRoomCreation = async (signature: string, publicKey: string) => {
    const signatories = selectedContacts.map((s) => ({
      matrixAddress: s.secureProtocolId,
      accountId: s.mainAccounts[0].accountId,
      isInviter: publicKey === s.mainAccounts[0].publicKey,
    }));

    await matrix.finishRoomCreation({
      roomId: mstRoom.current?.roomId || '',
      inviterPublicKey: mstRoom.current?.inviterPublicKey || '',
      accountName: mstRoom.current?.accountName || '',
      mstAccountAddress: mstRoom.current?.mstAccountAddress || '',
      signatories,
      signature,
      threshold: mstRoom.current?.threshold || 0,
    });
  };

  const startRoomCreation = async (
    mstAccountAddress: string,
  ): Promise<string> => {
    const addressesMap = selectedContacts.reduce((acc, contact) => {
      acc[contact.mainAccounts[0].publicKey] = true;

      return acc;
    }, {} as Record<string, boolean>);

    const myAddress = wallets?.find(
      (w) =>
        !isMultisig(w) && w.mainAccounts.some((a) => addressesMap[a.publicKey]),
    )?.mainAccounts[0];

    // Create room only if I'm a signatory
    if (!myAddress) return '';

    const roomData = await matrix.startRoomCreation(mstAccountAddress);
    mstRoom.current = {
      ...mstRoom.current,
      roomId: roomData.roomId,
      sign: roomData.sign,
      inviterPublicKey: myAddress.publicKey,
    };
    return myAddress.publicKey;
  };

  const deriveMultisigWallet = (
    walletName: string,
    threshold: string,
  ): string => {
    const { mstSs58Address, payload } = createMultisigWalletPayload({
      walletName,
      threshold,
      addresses: selectedContacts.map((c) => c.mainAccounts[0].accountId),
      contacts: selectedContacts,
    });

    const sameMstAccount = wallets?.find((w) =>
      w.mainAccounts.some((main) => main.accountId === mstSs58Address),
    );
    if (sameMstAccount) return '';

    mstWallet.current = payload;
    mstRoom.current = {
      ...mstRoom.current,
      accountName: walletName,
      threshold: Number(threshold),
      mstAccountAddress: mstSs58Address,
    };
    return mstSs58Address;
  };

  const createMultisigWallet = async (
    walletName: string,
    threshold: string,
  ) => {
    const mstAddress = deriveMultisigWallet(walletName, threshold);
    if (!mstAddress) {
      openDialogWithType('mst');
      return;
    }

    if (!matrix.isLoggedIn) {
      if (mstWallet.current) {
        db.wallets.add(mstWallet.current);
      }
      return;
    }

    const inviterPublicKey = await startRoomCreation(mstAddress);
    if (!inviterPublicKey) {
      openDialogWithType('room');

      if (mstWallet.current) {
        db.wallets.add(mstWallet.current);
      }
      return;
    }

    await finishRoomCreation('fake_signature', inviterPublicKey);
    if (mstRoom.current?.roomId && mstWallet.current) {
      db.wallets.add({
        ...mstWallet.current,
        matrixRoomId: mstRoom.current.roomId,
      });
    }
  };

  const handleMultisigSubmit: SubmitHandler<MultisigWalletForm> = async ({
    walletName,
    threshold,
  }) => {
    if (wallet) {
      updateMultisigWallet(wallet, walletName);
    } else {
      try {
        setIsRoomCreating(true);
        await createMultisigWallet(walletName, threshold);
      } catch (error) {
        openDialogWithType('create');
      }
      mstRoom.current = undefined;
      mstWallet.current = undefined;
      setIsRoomCreating(false);
      setSelectedContacts([]);
      reset();
    }
  };

  const updateSelectedContact = (contact: Contact) => {
    const isSelected = selectedContacts.some((c) => isSameAccount(c, contact));
    const newContacts = isSelected
      ? selectedContacts.filter((c) => !isSameAccount(c, contact))
      : selectedContacts.concat(contact);

    setSelectedContacts(newContacts);
  };

  const forgetMultisigWallet = async () => {
    if (id) {
      await db.wallets.delete(Number(id));
      setSelectedWallets((selectedWallets) =>
        selectedWallets.filter((w) => w.id && w.id !== Number(id)),
      );
    }
    toggleDialogOpen();
    history.push(Routes.WALLETS);
  };

  const isContactSelected = (contact: Contact) => {
    const collection = wallet ? wallet.originContacts : selectedContacts;
    return collection.some((c) => isSameAccount(c, contact));
  };

  const availableContacts = useMemo(() => {
    if (wallet) return wallet.originContacts;

    return combinedContacts(wallets, contacts).map((contact) => ({
      ...contact,
      ...(!contact.secureProtocolId && {
        secureProtocolId: matrix.userId,
      }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets?.length, contacts.length]);

  // Cancel room creation in case we refresh page during room creation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelRoomCreation(), []);

  return (
    <>
      <h2 className="font-light text-xl p-4">
        {wallet ? 'Edit multisig wallet' : 'Create multisig wallet'}
      </h2>

      <form onSubmit={handleSubmit(handleMultisigSubmit)}>
        <div className="flex">
          <div className="p-2 w-1/2">
            <Controller
              name="walletName"
              control={control}
              rules={{ required: true }}
              render={({ field: { onChange, onBlur, value } }) => (
                <InputText
                  onChange={onChange}
                  onBlur={onBlur}
                  value={value}
                  className="w-full"
                  label="Wallet name"
                  placeholder="Wallet name"
                />
              )}
            />
          </div>
          <div className="p-2 w-1/2">
            <Controller
              name="threshold"
              control={control}
              rules={wallet ? {} : { min: 2, max: selectedContacts.length }}
              render={({ field: { onChange, onBlur, value } }) => (
                <InputText
                  type="number"
                  onChange={onChange}
                  onBlur={onBlur}
                  value={value}
                  disabled={!!wallet}
                  className="w-full"
                  label="Threshold"
                  placeholder="Threshold"
                />
              )}
            />
          </div>
        </div>

        {wallet && (
          <div className="p-2">
            <Card className="m-0">
              <div className="text-gray-500 text-sm mb-2">Address</div>

              <Address full address={wallet.mainAccounts[0].accountId} />
            </Card>
          </div>
        )}

        <div className="p-2">
          <Card className={`m-0 ${wallet && 'bg-gray-100'}`}>
            <div className="text-gray-500 text-sm mb-2">Signatures</div>

            {availableContacts.map((contact) => (
              <div
                key={contact.mainAccounts[0].accountId}
                className="flex items-center gap-3 p-2"
              >
                <Checkbox
                  disabled={!!wallet}
                  checked={isContactSelected(contact)}
                  onChange={() => updateSelectedContact(contact)}
                />
                <div>
                  {contact.name && <div>{contact.name}</div>}
                  <Address full address={contact.mainAccounts[0].accountId} />
                </div>
              </div>
            ))}
          </Card>
        </div>
        <div className="p-2 flex">
          <Button
            size="lg"
            disabled={!isValid || isRoomCreating}
            type="submit"
            isLoading={isRoomCreating}
          >
            {wallet ? 'Update' : 'Create'}
          </Button>
          {wallet && (
            <Button
              className="ml-3"
              onClick={() => openDialogWithType('forget')}
              size="lg"
            >
              Forget
            </Button>
          )}
        </div>
      </form>

      <Dialog
        as="div"
        className="relative z-10"
        open={isDialogOpen}
        onClose={toggleDialogOpen}
      >
        <DialogContent>
          <Dialog.Title as="h3" className="font-light text-xl">
            {DIALOG_CONTENT[dialogType].title}
          </Dialog.Title>
          <div className="mt-2">{DIALOG_CONTENT[dialogType].subtitle}</div>
          {DIALOG_CONTENT[dialogType].buttons(
            toggleDialogOpen,
            forgetMultisigWallet,
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ManageMultisigWallet;
