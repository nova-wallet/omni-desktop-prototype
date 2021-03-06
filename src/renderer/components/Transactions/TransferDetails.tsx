/* eslint-disable promise/always-return,consistent-return */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { useHistory, useParams } from 'react-router';
import { format } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import Button from '../../ui/Button';
import {
  currentTransactionState,
  signWithState,
} from '../../store/currentTransaction';
import Address from '../../ui/Address';
import { Routes } from '../../../common/constants';
import { db } from '../../db/db';
import {
  MultisigWallet,
  TransactionStatus,
  TransactionType,
  Wallet,
} from '../../db/types';
import {
  formatAddress,
  getAddressFromWallet,
  toPublicKey,
} from '../../utils/account';
import { formatBalanceFromAmount, getAssetById } from '../../utils/assets';
import LinkButton from '../../ui/LinkButton';
import copy from '../../../../assets/copy.svg';
import Select, { OptionType } from '../../ui/Select';
import InputText from '../../ui/Input';
import { Connection, connectionState } from '../../store/connections';
import Signatories from './Signatories';
import Chat from './Chat';
import {
  decodeCallData,
  getApprovals,
  updateTimepointFromBlockchain,
  updateTransaction,
} from '../../utils/transactions';
import { copyToClipboard } from '../../utils/strings';
import Fee from '../../ui/Fee';
import Balance from '../../ui/Balance';
import { useMatrix } from '../Providers/MatrixProvider';
import { MstParams, OmniMstEvents } from '../../modules/types';

const TransferDetails: React.FC = () => {
  const history = useHistory();
  const { notifications } = useMatrix();
  const { id } = useParams<{ id: string }>();

  const [, setSignWith] = useRecoilState(signWithState);
  const networks = useRecoilValue(connectionState);
  const setCurrentTransaction = useSetRecoilState(currentTransactionState);

  const [callData, setCallData] = useState<string>();
  const [availableWallets, setAvailableWallets] = useState<OptionType[]>([]);
  const [connection, setConnection] = useState<Connection>();

  const wallets = useLiveQuery(() => db.wallets.toArray());
  const transaction = useLiveQuery(() => db.transactions.get(Number(id)));
  const network = useLiveQuery(
    () => db.chains.get({ chainId: transaction?.chainId || '' }),
    [transaction?.chainId],
  );

  const isTransfer = transaction?.type === TransactionType.TRANSFER;
  const isMultisigTransfer =
    transaction?.type === TransactionType.MULTISIG_TRANSFER;

  const isCreated = transaction?.status === TransactionStatus.CREATED;
  const isConfirmed = transaction?.status === TransactionStatus.CONFIRMED;
  const isSelectWalletAvailable =
    isMultisigTransfer &&
    transaction.data.callData &&
    availableWallets.length > 0 &&
    !isConfirmed;

  const isSignable =
    (isTransfer ||
      (isMultisigTransfer &&
        transaction.data.callData &&
        availableWallets.length > 0)) &&
    !isConfirmed;

  const description = useMemo(() => {
    if (!transaction || !notifications.length) return undefined;

    const initNotification = notifications.find((notif) => {
      const { salt, callHash } = notif.content as MstParams;
      return (
        notif.type === OmniMstEvents.INIT &&
        callHash === transaction?.data.callHash &&
        salt === transaction?.data.salt
      );
    });
    if (!initNotification) return undefined;

    return (initNotification.content as MstParams).description;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.length, transaction]);

  useEffect(() => {
    setSignWith(undefined);
    setCurrentTransaction(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let timepointInterval: NodeJS.Timeout;
    if (transaction && Object.values(networks).length) {
      const currentConnection = Object.values(networks).find(
        (n) => n.network.chainId === transaction.chainId,
      );

      if (currentConnection) {
        setConnection(currentConnection);
        if (!transaction.blockHeight) {
          timepointInterval = setInterval(
            () => updateTimepointFromBlockchain(transaction, currentConnection),
            1000,
          );
        }
      }
    }

    return () => {
      clearInterval(timepointInterval);
    };
  }, [transaction, networks]);

  useEffect(() => {
    if (!network || !isMultisigTransfer) return;

    const walletsToSign = wallets?.reduce((acc, w) => {
      const address = getAddressFromWallet(w, network);

      const contacts = (
        transaction?.wallet as MultisigWallet
      ).originContacts?.map((c) => getAddressFromWallet(c, network));

      const approval = transaction?.data?.approvals[toPublicKey(address)];

      if (
        address &&
        !(approval?.fromBlockChain || approval?.fromMatrix) &&
        contacts?.includes(address)
      ) {
        acc.push(w as Wallet);
      }

      return acc;
    }, [] as Wallet[]);

    if (walletsToSign) {
      setSignWith(walletsToSign[0]);
      setAvailableWallets(
        walletsToSign.map((w) => ({
          value: w.mainAccounts[0].publicKey,
          label: w.name,
        })),
      );
    }
  }, [
    wallets,
    transaction?.data.approvals,
    transaction?.wallet,
    isMultisigTransfer,
    network,
    setSignWith,
  ]);

  const currentAsset = getAssetById(
    network?.assets || [],
    transaction?.data.assetId,
  );

  const tokenSymbol = currentAsset?.symbol || '';

  const showQR = () => {
    setCurrentTransaction(transaction);
    history.push(Routes.SHOW_CODE);
  };

  const removeTransaction = () => {
    if (!transaction?.id) return;

    db.transactions.delete(transaction.id);
    history.push(Routes.BASKET);
  };

  const formatRecipientAddress = (address: string) =>
    network ? formatAddress(address, network.addressPrefix) : address;

  const selectSignWallet = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSignWith(
      wallets?.find(
        (w) => w.mainAccounts[0].publicKey === e.target.value,
      ) as Wallet,
    );
  };

  const updateCallData = useCallback(
    (callDataParam) => {
      const innerCallData = callDataParam || callData;
      if (!transaction || !innerCallData || !connection) return;

      const decodedData = decodeCallData(
        connection.api,
        connection.network,
        innerCallData,
      );

      db.transactions.put({
        ...transaction,
        data: {
          ...transaction.data,
          callData: innerCallData,
          ...decodedData,
        },
      });

      setCallData('');
    },
    [transaction, callData, connection],
  );

  useEffect(() => {
    if (!transaction || !connection || isConfirmed) return;

    const updateInterval = setInterval(async () => {
      const tx = await db.transactions.get(Number(id));
      if (tx) updateTransaction(tx, connection);
    }, 2000);

    return () => {
      clearInterval(updateInterval);
    };
  }, [connection, isConfirmed, transaction, id]);

  // Check this case
  useEffect(() => {
    if (transaction?.data.callData && !transaction?.data.amount) {
      updateCallData(transaction.data.callData);
    }
  }, [transaction, updateCallData]);

  return (
    <>
      <div className="flex justify-center items-center mb-8">
        <LinkButton className="ml-2 absolute left-0" to={Routes.BASKET}>
          Back
        </LinkButton>
        <h2 className="h-16 p-4 font-light text-lg">Operation details</h2>
      </div>

      <div className="flex justify-center gap-6">
        <div className="mb-10 w-[350px] bg-gray-100 px-4 py-3 rounded-2xl">
          <div className="flex justify-between items-center  mb-6">
            <h1 className="text-2xl font-normal">Preview</h1>
            <span className="text-gray-500 text-sm">
              {transaction &&
                format(transaction.createdAt, 'HH:mm:ss dd MMM, yyyy')}
            </span>
          </div>

          <div className="max-h-[450px] overflow-y-auto mb-6">
            <div className="text-sm text-gray-500 mb-2">Selected account</div>
            <div className="flex justify-between items-center">
              <div>
                <div>{transaction?.wallet.name}</div>
                <div>
                  {network && transaction && (
                    <div>
                      <Address address={transaction.address} />
                    </div>
                  )}
                </div>
              </div>
              {connection && transaction && currentAsset && (
                <div className="bg-gray-200 py-1 px-2 rounded-lg">
                  <div className="flex justify-end text-gray-500 uppercase text-xs font-normal">
                    Transferable
                  </div>
                  <div className="flex justify-end text-black text-sm">
                    <Balance
                      asset={currentAsset}
                      connection={connection}
                      walletAddress={getAddressFromWallet(
                        transaction.wallet,
                        network,
                      )}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="text-sm text-gray-500">Operation details:</div>
          {transaction && (
            <div className="inline">
              {transaction.data.amount && (
                <>
                  Transfer{' '}
                  {formatBalanceFromAmount(
                    transaction.data.amount,
                    currentAsset?.precision,
                  )}{' '}
                  {tokenSymbol} to
                  <Address
                    className="ml-1"
                    address={formatRecipientAddress(transaction.data.address)}
                  />
                </>
              )}
            </div>
          )}
          {isMultisigTransfer && description && (
            <>
              <div className="text-sm text-gray-500 mt-2">
                Operation description:
              </div>
              <div className="text-md leading-none">{description}</div>
            </>
          )}
          {isMultisigTransfer && (
            <>
              {!!transaction.data.callHash && (
                <div className="text-xs text-gray-500 mt-3">
                  <div className="flex justify-between items-center">
                    <div className="font-bold">Call hash:</div>
                    <button
                      onClick={() => copyToClipboard(transaction.data.callHash)}
                    >
                      <img src={copy} alt="copy" />
                    </button>
                  </div>
                  <div className="break-words">{transaction.data.callHash}</div>
                </div>
              )}
              {!!transaction.data.callData && (
                <div className="text-xs text-gray-500 mt-3">
                  <div className="flex justify-between items-center">
                    <div className="font-bold">Call data:</div>
                    <button
                      onClick={() => copyToClipboard(transaction.data.callData)}
                    >
                      <img src={copy} alt="copy" />
                    </button>
                  </div>
                  <div className="break-words">{transaction.data.callData}</div>
                </div>
              )}
              {isMultisigTransfer && !transaction.data.callData && (
                <div className="flex mt-3">
                  <InputText
                    className="mr-3"
                    label="Call data"
                    onChange={(e) => setCallData(e.target.value)}
                  />
                  <Button onClick={updateCallData}>Save</Button>
                </div>
              )}
            </>
          )}
          {transaction &&
            transaction.status !== TransactionStatus.CONFIRMED &&
            transaction.data.callData && (
              <>
                <hr className="my-5" />
                <Fee
                  type={
                    isMultisigTransfer
                      ? TransactionType.MULTISIG_TRANSFER
                      : TransactionType.TRANSFER
                  }
                  walletAddress={getAddressFromWallet(
                    transaction.wallet,
                    network,
                  )}
                  threshold={(transaction.wallet as MultisigWallet).threshold}
                  transaction={transaction}
                  connection={connection}
                  address={transaction.data.address}
                  amount={transaction.data.amount}
                  withDeposit={
                    isMultisigTransfer && getApprovals(transaction).length === 0
                  }
                />
              </>
            )}
        </div>
        {isMultisigTransfer && (
          <>
            <Signatories network={network} transaction={transaction} />
            <Chat network={network} transaction={transaction} />
          </>
        )}
      </div>
      {isSelectWalletAvailable && (
        <div className="mx-auto mb-2 w-[350px]">
          <Select
            label="Select wallet to sign with"
            options={availableWallets}
            onChange={selectSignWallet}
          />
        </div>
      )}
      {isSignable && (
        <div className="mx-auto mb-2 w-[350px]">
          <Button className="w-full" size="lg" onClick={showQR}>
            Send for signing
          </Button>
        </div>
      )}
      {isCreated && (
        <div className="mx-auto w-[350px]">
          <Button className="w-full" size="lg" onClick={removeTransaction}>
            Remove
          </Button>
        </div>
      )}
    </>
  );
};

export default TransferDetails;
