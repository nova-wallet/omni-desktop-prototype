/* eslint-disable promise/always-return */
import React, { ReactNode, useEffect, useState } from 'react';
import { BN } from '@polkadot/util';
import { Asset, Wallet, MultisigWallet } from '../db/types';
import { getAddressFromWallet } from '../utils/account';
import { formatBalance } from '../utils/assets';
import { Connection } from '../store/connections';
import { isMultisig, validateAddress } from '../utils/validation';
import { getTxExtrinsic } from '../utils/transactions';
import Shimmer from './Shimmer';

type Props = {
  wallet?: Wallet | MultisigWallet;
  asset?: Asset;
  connection?: Connection;
  address: string;
  amount: string;
  withDeposit?: boolean;
};

const Fee: React.FC<Props> = ({
  wallet,
  asset,
  connection,
  address,
  amount,
  withDeposit,
}) => {
  const [transactionFee, setTransactionFee] = useState('0');
  const defaultAsset = connection?.network.assets[0];

  useEffect(() => {
    if (
      !wallet ||
      !connection ||
      !asset ||
      !validateAddress(address) ||
      !amount
    ) {
      setTransactionFee('0');
      return;
    }

    const fromAddress = getAddressFromWallet(wallet, connection.network);

    getTxExtrinsic(connection, asset, address, amount)
      .paymentInfo(fromAddress)
      .then(({ partialFee }) => {
        const formattedValue = formatBalance(
          partialFee.toString(),
          defaultAsset?.precision,
        );
        setTransactionFee(`${formattedValue} ${defaultAsset?.symbol}`);
      })
      .catch((error) => {
        console.warn(error);
        setTransactionFee('0');
      });
  }, [connection, amount, address, asset, defaultAsset, wallet]);

  const depositValue = (): string | ReactNode => {
    if (!connection) {
      return <Shimmer width="80px" height="20px" />;
    }

    const { depositFactor, depositBase } = connection.api.consts.multisig;
    const balance = depositBase.add(
      depositFactor.mul(new BN((wallet as MultisigWallet).threshold)),
    );
    const deposit = formatBalance(balance.toString(), asset?.precision);
    return `${deposit} ${defaultAsset?.symbol}`;
  };

  return (
    <div className="flex flex-col text-gray-500 text-sm gap-1">
      <div className="flex justify-between">
        <div>Transaction fee</div>
        <div>{transactionFee || <Shimmer width="80px" height="20px" />}</div>
      </div>
      {withDeposit && isMultisig(wallet) && (
        <>
          <div className="flex justify-between">
            <div>Deposit</div>
            <div>{depositValue()}</div>
          </div>
          <div className="text-xs text-gray-400 italic">
            The deposit stays locked until the transaction is executed or
            cancelled
          </div>
        </>
      )}
    </div>
  );
};

export default Fee;