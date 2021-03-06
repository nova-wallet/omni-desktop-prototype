import { WellKnownChain } from '@substrate/connect';
import statemine from './chainSpecs/statemine.json';
import westmint from './chainSpecs/westmint.json';

const KnownChainSpecs: Record<string, string> = {
  Statemine: JSON.stringify(statemine),
  Westmint: JSON.stringify(westmint),
};

const KnownChains: Record<string, WellKnownChain> = {
  Kusama: WellKnownChain.ksmcc3,
  Polkadot: WellKnownChain.polkadot,
  Westend: WellKnownChain.westend2,
};

export function getKnownChainId(chainId: string): WellKnownChain | undefined {
  return KnownChains[chainId];
}

export function getChainSpec(name: string): string {
  return KnownChainSpecs[name] || '';
}
