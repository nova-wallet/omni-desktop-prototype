import React, { ChangeEvent, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { useHistory } from 'react-router';
import { decodeAddress } from '@polkadot/keyring';
import { u8aToHex } from '@polkadot/util';
import { Dialog } from '@headlessui/react';
import { useSetRecoilState } from 'recoil';
import { useForm, Controller, SubmitHandler } from 'react-hook-form';
import { db } from '../../db/db';
import { Account, ChainAccount, Chain } from '../../db/types';
import InputText from '../../ui/Input';
import Button from '../../ui/Button';
import List from '../../ui/List';
import ListItem from '../../ui/ListItem';
import Select, { OptionType } from '../../ui/Select';
import Address from '../../ui/Address';
import DialogContent from '../../ui/DialogContent';
import { Routes, ErrorTypes } from '../../../common/constants';
import { selectedWalletsState } from '../../store/selectedWallets';
import { validateAddress } from '../../utils/validation';
import ErrorMessage from '../../ui/ErrorMessage';
import { formatAddress } from '../../utils/account';
import useToggle from '../../hooks/toggle';

const enum AccountTypes {
  MAIN = 'MAIN',
  CHAIN = 'CHAIN',
}

const AccountTypeOptions = [
  {
    label: 'Main',
    value: AccountTypes.MAIN,
  },
  {
    label: 'Chain',
    value: AccountTypes.CHAIN,
  },
];

type AddressForm = {
  address: string;
};

const Wallet: React.FC = () => {
  const history = useHistory();
  const { id } = useParams<{ id: string }>();

  const {
    handleSubmit,
    control,
    reset,
    formState: { isValid, errors },
  } = useForm<AddressForm>({
    mode: 'onChange',
    defaultValues: {
      address: '',
    },
  });

  const [name, setName] = useState('');
  const [networkOptions, setNetworkOptions] = useState<OptionType[]>([]);
  const [accountNetwork, setAccountNetwork] = useState<string>();
  const [accountType, setAccountType] = useState(AccountTypes.MAIN);
  const [accounts, setAccounts] = useState<
    {
      account: Account | ChainAccount | null;
      network: Chain;
    }[]
  >();

  const [isDialogOpen, toggleDialogOpen] = useToggle(false);
  const setSelectedWallets = useSetRecoilState(selectedWalletsState);

  const networks = useLiveQuery(() => db.chains.toArray());
  const wallet = useLiveQuery(() => db.wallets.get(Number(id)));

  useEffect(() => {
    if (wallet) {
      setName(wallet.name);
    }
  }, [wallet]);

  const forgetWallet = async () => {
    if (wallet?.id) {
      await db.wallets.delete(wallet.id);
      setSelectedWallets((selectedWallets) =>
        selectedWallets.filter((w) => w.id !== wallet.id),
      );
    }
    toggleDialogOpen();
    history.push(Routes.WALLETS);
  };

  // const NetworkTypeOptions = [
  //   {
  //     label: 'ECDSA',
  //     value: CryptoType.ECDSA,
  //   },
  //   {
  //     label: 'Ed25519',
  //     value: CryptoType.ED25519,
  //   },
  //   {
  //     label: 'Sr25519',
  //     value: CryptoType.SR25519,
  //   },
  //   {
  //     label: 'Ethereum',
  //     value: CryptoType.ETHEREUM,
  //   },
  // ];

  useEffect(() => {
    const options =
      networks
        ?.filter(
          (n) => !wallet?.chainAccounts.find((c) => c.chainId === n.chainId),
        )
        .map((n) => ({
          label: n.name,
          value: n.chainId,
        })) || [];

    setNetworkOptions(options);
  }, [networks, wallet]);

  useEffect(() => {
    if (!accountNetwork) {
      setAccountNetwork(networkOptions[0]?.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkOptions.length]);

  useEffect(() => {
    const accountList = networks
      ?.map((n) => {
        const chainAccount = wallet?.chainAccounts.find(
          (c) => c.chainId === n.chainId,
        );

        if (chainAccount) {
          return {
            account: chainAccount,
            network: n,
          };
        }

        const mainAccount = wallet?.mainAccounts[0];

        if (mainAccount) {
          const updatedAccountId = formatAddress(
            mainAccount.accountId,
            n.addressPrefix,
          );
          const updatedMainAccount = {
            ...mainAccount,
            accountId: updatedAccountId,
          };
          return {
            account: updatedMainAccount,
            network: n,
          };
        }

        return {
          account: null,
          network: n,
        };
      })
      .filter((n) => n.account);

    setAccounts(accountList);
  }, [networks, wallet]);

  const addAccount: SubmitHandler<AddressForm> = async ({ address }) => {
    // TODO: Add validation for account address
    // const keyring = new Keyring();
    // const pair = keyring.addFromAddress(address);
    const publicKey = decodeAddress(address);
    const publicKeyHex = u8aToHex(publicKey);

    const doesntExists = !wallet?.chainAccounts.find(
      (c) => c.chainId === accountNetwork,
    );

    if (!address || !wallet?.id) return;
    if (accountType === AccountTypes.CHAIN && doesntExists && accountNetwork) {
      await db.wallets.update(wallet.id, {
        chainAccounts: [
          ...wallet.chainAccounts,
          {
            accountId: formatAddress(address),
            chainId: accountNetwork,
            publicKey: publicKeyHex,
          },
        ],
      });

      setAccountNetwork(undefined);
    } else if (accountType === AccountTypes.MAIN) {
      // TODO: add support for main accounts of different types
      await db.wallets.update(wallet.id, {
        mainAccounts: [
          {
            accountId: address,
            publicKey: publicKeyHex,
          },
        ],
      });

      reset();
    }
  };

  const removeAccount = async (chainId: string) => {
    // TODO: Add possibility to remove main accounts
    if (wallet?.id) {
      await db.wallets.update(wallet.id, {
        chainAccounts: wallet.chainAccounts.filter(
          (c) => c.chainId !== chainId,
        ),
      });
    }
  };

  const updateWallet = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (wallet?.id) {
      const trimmedName = name.trim();
      await db.wallets.update(wallet.id, {
        name: trimmedName,
      });
      setName(trimmedName);
    }
  };

  const onChangeWalletName = (event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  };

  const onChangeAccountNetwork = (event: ChangeEvent<HTMLSelectElement>) => {
    setAccountNetwork(event.target.value);
  };

  const onChangeAccountType = (event: ChangeEvent<HTMLSelectElement>) => {
    setAccountType(event.target.value as AccountTypes);
  };

  // const onChangeNetworkType = (event: ChangeEvent<HTMLSelectElement>) => {
  //   setNetworkType(event.target.value);
  // };

  return (
    <>
      <h2 className="font-light text-xl p-4">Edit wallet</h2>

      <form onSubmit={updateWallet}>
        <div className="p-2">
          <InputText
            className="w-full"
            label="Wallet name"
            placeholder="Wallet name"
            value={name}
            onChange={onChangeWalletName}
          />
        </div>

        <div className="p-2 flex items-center">
          <Button size="lg" disabled={name === wallet?.name} type="submit">
            Update
          </Button>
          <Button className="ml-3" size="lg" onClick={toggleDialogOpen}>
            Forget
          </Button>
        </div>
      </form>

      <h2 className="font-light text-xl p-4">Accounts</h2>

      <form onSubmit={handleSubmit(addAccount)}>
        <div className="p-2">
          <Select
            className="w-full"
            label="Account type"
            placeholder="Account type"
            value={accountType}
            options={AccountTypeOptions}
            onChange={onChangeAccountType}
          />
        </div>
        {accountType === AccountTypes.CHAIN && (
          <div className="p-2">
            <Select
              className="w-full"
              label="Network"
              placeholder="Network"
              value={accountNetwork}
              options={networkOptions}
              onChange={onChangeAccountNetwork}
            />

            {/* {accountType === AccountTypes.MAIN && (
              <Select
                className="w-full"
                label="Network type"
                placeholder="Network type"
                value={networkType}
                options={networkOptions}
                onChange={onChangeNetworkType}
              />
            )} */}
          </div>
        )}
        <div className="p-2">
          <Controller
            name="address"
            control={control}
            rules={{ required: true, validate: validateAddress }}
            render={({ field: { onChange, onBlur, value } }) => (
              <InputText
                onChange={onChange}
                onBlur={onBlur}
                value={value}
                invalid={!!errors.address}
                address
                name="address"
                className="w-full"
                label="Account address"
                placeholder="Account address"
              />
            )}
          />
          <ErrorMessage visible={errors.address?.type === ErrorTypes.VALIDATE}>
            The address is not valid, please type it again
          </ErrorMessage>
          <ErrorMessage visible={errors.address?.type === ErrorTypes.REQUIRED}>
            The address is required
          </ErrorMessage>
        </div>
        <div className="p-2">
          <Button size="lg" type="submit" disabled={!isValid}>
            Add account
          </Button>
        </div>
      </form>

      <div className="m-2">
        <List>
          {accounts?.map(({ account, network }) => (
            <ListItem key={network.chainId}>
              <img
                className="w-8 mr-2 invert"
                src={network.icon}
                alt={network.name}
              />
              <div>
                <div>{network.name}</div>
                <div>
                  <Address address={account?.accountId || ''} />
                </div>
              </div>
              <Button
                className="ml-auto max-w-min"
                disabled={!(account as ChainAccount)?.chainId}
                onClick={() => removeAccount(network.chainId || '')}
              >
                Remove
              </Button>
            </ListItem>
          ))}
        </List>
      </div>

      <Dialog
        as="div"
        className="relative z-10"
        open={isDialogOpen}
        onClose={toggleDialogOpen}
      >
        <DialogContent>
          <Dialog.Title as="h3" className="font-light text-xl">
            Forget wallet
          </Dialog.Title>
          <div className="mt-2">
            Are you sure you want to forget this wallet?
          </div>

          <div className=" mt-2 flex justify-between">
            <Button className="max-w-min" onClick={toggleDialogOpen}>
              Cancel
            </Button>
            <Button className="max-w-min" onClick={forgetWallet}>
              Forget
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Wallet;
