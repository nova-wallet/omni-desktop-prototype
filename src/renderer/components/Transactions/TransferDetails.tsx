/* eslint-disable promise/always-return */
import React, { useCallback, useEffect, useState } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { useHistory, useParams } from 'react-router';
import { format } from 'date-fns';
import cn from 'classnames';
import { useLiveQuery } from 'dexie-react-hooks';
import { Call } from '@polkadot/types/interfaces';
import { SubmittableExtrinsic } from '@polkadot/api/types';

import Button from '../../ui/Button';
import {
  currentTransactionState,
  signFromState,
} from '../../store/currentTransaction';
import Address from '../../ui/Address';
import { Routes, StatusType } from '../../../common/constants';
import { db } from '../../db/db';
import {
  Chain,
  Transaction,
  MultisigWallet,
  TransactionType,
  Wallet,
} from '../../db/types';
import { formatAddress, getAddressFromWallet } from '../../utils/account';
import {
  formatBalance,
  formatBalanceFromAmount,
  getAssetById,
} from '../../utils/assets';
import LinkButton from '../../ui/LinkButton';
import copy from '../../../../assets/copy.svg';
import Status from '../../ui/Status';
import Select, { OptionType } from '../../ui/Select';
import InputText from '../../ui/Input';
import { Connection, connectionState } from '../../store/connections';

const TransferDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const history = useHistory();
  const [transaction, setTransaction] = useState<Transaction>();
  const [network, setNetwork] = useState<Chain>();
  const [callData, setCallData] = useState<string>();

  const [availableWallets, setAvailableWallets] = useState<OptionType[]>([]);
  const wallets = useLiveQuery(() => db.wallets.toArray());
  const [, setSignFrom] = useRecoilState(signFromState);

  const isTransfer = transaction?.type === TransactionType.TRANSFER;
  const isMultisigTransfer =
    transaction?.type === TransactionType.MULTISIG_TRANSFER;

  const [connection, setConnection] = useState<Connection>();
  const networks = useRecoilValue(connectionState);

  useEffect(() => {
    if (transaction && Object.values(networks).length) {
      const currentConnection = Object.values(networks).find(
        (n) => n.network.chainId === transaction.chainId,
      );

      if (currentConnection) {
        setConnection(currentConnection);
      }
    }
  }, [transaction, networks]);

  useEffect(() => {
    if (!network || !isMultisigTransfer) return;

    const walletsToSign = wallets?.reduce((acc, w) => {
      const address = getAddressFromWallet(w, network);

      const contacts = (
        transaction?.wallet as MultisigWallet
      ).originContacts?.map((c) => c.mainAccounts[0].accountId);

      if (
        address &&
        !transaction?.data?.approvals?.includes(address) &&
        contacts?.includes(address)
      ) {
        acc.push(w as Wallet);
      }

      return acc;
    }, [] as Wallet[]);

    if (walletsToSign) {
      setSignFrom(walletsToSign[0]);
      setAvailableWallets(
        walletsToSign.map((w) => ({
          value: w.mainAccounts[0].accountId,
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
    setSignFrom,
  ]);

  const setupTransaction = useCallback(() => {
    if (!id) return;

    db.transactions
      .get(Number(id))
      .then((tx) => {
        if (tx) {
          setTransaction(tx);
        }
      })
      .catch((e) => console.log(e));
  }, [id]);

  useEffect(() => {
    setupTransaction();
  }, [setupTransaction]);

  useEffect(() => {
    if (!transaction?.chainId) return;

    db.chains
      .get({ chainId: transaction.chainId })
      .then((chain) => {
        if (chain) {
          setNetwork(chain);
        }
      })
      .catch((e) => console.log(e));
  }, [transaction?.chainId]);

  const setCurrentTransaction = useSetRecoilState(currentTransactionState);

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

  const copyToClipboard = (text = '') => {
    navigator.clipboard.writeText(text);
  };

  const isApproved = (address: string): boolean => {
    if (!transaction?.data.approvals) return false;

    return transaction.data.approvals.includes(address);
  };

  const handleSignFromChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const walletAddress = e.target.value;

    setSignFrom(
      wallets?.find(
        (w) => w.mainAccounts[0].accountId === walletAddress,
      ) as Wallet,
    );
  };

  const updateCallData = () => {
    if (!transaction || !callData || !connection) return;

    const data: Record<string, any> = {
      ...transaction.data,
      callData,
    };
    let extrinsicCall: Call;
    let decoded: SubmittableExtrinsic<'promise'> | null = null;

    try {
      // cater for an extrinsic input...
      decoded = connection.api.tx(callData);
      extrinsicCall = connection.api.createType('Call', decoded.method);
    } catch (e) {
      extrinsicCall = connection.api.createType('Call', callData);
    }

    const { method, section } = connection.api.registry.findMetaCall(
      extrinsicCall.callIndex,
    );
    const extrinsicFn = connection.api.tx[section][method];
    const extrinsic = extrinsicFn(...extrinsicCall.args);

    if (!decoded) {
      decoded = extrinsic;
    }
    if (method === 'transfer' && section === 'balances') {
      data.address = decoded.args[0].toString();
      data.amount = formatBalance(
        decoded.args[1].toString(),
        network?.assets[0].precision || 0,
      );
      console.log(data.amount);
    }
    if (method === 'transfer' && section === 'assets') {
      data.assetId = decoded.args[0].toString();
      data.address = decoded.args[1].toString();
      const asset = getAssetById(network?.assets || [], data.assetId);
      data.amount = formatBalance(
        decoded.args[2].toString(),
        asset?.precision || 0,
      );
    }
    if (method === 'transfer' && section === 'currencies') {
      data.address = decoded.args[0].toString();
      data.assetId = decoded.args[1].toString();
      const asset = getAssetById(network?.assets || [], data.assetId);
      data.amount = formatBalance(
        decoded.args[2].toString(),
        asset?.precision || 0,
      );
    }

    db.transactions.put({
      ...transaction,
      data,
    });
    setupTransaction();
    setCallData('');
  };

  const signatories =
    network &&
    ((transaction?.wallet as MultisigWallet).originContacts ?? []).map(
      (signature) => ({
        name: signature.name,
        address: getAddressFromWallet(signature, network),
        status: isApproved(getAddressFromWallet(signature, network)),
      }),
    );

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

          <div className="mb-6">
            <div className="text-sm text-gray-500 mb-2">Selected account</div>
            <div>{transaction?.wallet.name}</div>
            <div>
              {network && transaction && (
                <div>
                  <Address
                    address={getAddressFromWallet(transaction.wallet, network)}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="text-sm text-gray-500">Operations details:</div>

          {isTransfer && (
            <div className="inline">
              Transfer {currentAsset?.precision}
              {formatBalanceFromAmount(
                transaction.data.amount,
                currentAsset?.precision,
              )}{' '}
              {tokenSymbol} to{' '}
              <Address
                address={formatRecipientAddress(transaction.data.address)}
              />
            </div>
          )}
          {isMultisigTransfer && (
            <>
              <div className="flex">
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
              <div className="flex">
                {transaction.data.deposit && currentAsset?.precision && (
                  <>
                    Deposit:{' '}
                    {formatBalance(
                      transaction.data.deposit,
                      currentAsset.precision,
                    )}{' '}
                    {tokenSymbol}
                  </>
                )}
              </div>
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
        </div>
        {isMultisigTransfer && (
          <div className="mb-10 w-[350px] bg-gray-100 px-4 py-3 rounded-2xl">
            <h1 className="text-2xl font-normal mb-4">Signatories</h1>
            <div className="text-3xl font-medium mb-7">
              {transaction.data.approvals?.length || 0} of{' '}
              {(transaction.wallet as MultisigWallet).threshold}
            </div>
            <div>
              {signatories &&
                signatories.map(({ status, name, address }) => (
                  <div
                    key={address}
                    className="flex justify-between items-center mb-4"
                  >
                    <div>
                      <div>{name}</div>
                      <div>
                        <div>
                          <Address address={address} />
                        </div>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'flex items-center font-medium text-xs',
                        !status && 'text-gray-500',
                      )}
                    >
                      {status ? 'signed' : 'waiting'}
                      <Status
                        className="ml-1"
                        status={
                          status ? StatusType.SUCCESS : StatusType.WAITING
                        }
                        alt={status ? 'success' : 'pending'}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
        {isMultisigTransfer && (
          <div className="mb-10 w-[350px] bg-gray-100 px-4 py-3 rounded-2xl">
            <h1 className="text-2xl font-normal mb-6">Chat</h1>
            {/* TODO: Add chat implimentation */}
          </div>
        )}
      </div>
      {isMultisigTransfer &&
        transaction.data.callData &&
        availableWallets.length > 0 && (
          <div className="mx-auto mb-2 w-[350px]">
            <Select
              label="Select wallet to sign from"
              options={availableWallets}
              onChange={handleSignFromChange}
            />
          </div>
        )}
      {isTransfer ||
        (isMultisigTransfer && transaction.data.callData && (
          <div className="mx-auto mb-2 w-[350px]">
            <Button className="w-full" size="lg" onClick={showQR}>
              Send for signing
            </Button>
          </div>
        ))}
      <div className="mx-auto w-[350px]">
        <Button className="w-full" size="lg" onClick={removeTransaction}>
          Remove
        </Button>
      </div>
    </>
  );
};

export default TransferDetails;