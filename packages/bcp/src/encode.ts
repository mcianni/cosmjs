/* eslint-disable @typescript-eslint/camelcase */
import { encodeSecp256k1Signature, types } from "@cosmwasm/sdk";
import {
  Algorithm,
  Amount,
  Fee,
  FullSignature,
  isSendTransaction,
  PubkeyBundle,
  SignedTransaction,
  UnsignedTransaction,
} from "@iov/bcp";
import { Encoding } from "@iov/encoding";

import { BankTokens, Erc20Token } from "./types";

const { toBase64 } = Encoding;

export function encodePubkey(pubkey: PubkeyBundle): types.PubKey {
  switch (pubkey.algo) {
    case Algorithm.Secp256k1:
      return {
        type: types.pubkeyType.secp256k1,
        value: toBase64(pubkey.data),
      };
    case Algorithm.Ed25519:
      return {
        type: types.pubkeyType.ed25519,
        value: toBase64(pubkey.data),
      };
    default:
      throw new Error("Unsupported pubkey algo");
  }
}

export function amountToBankCoin(amount: Amount, tokens: BankTokens): types.Coin {
  const match = tokens.find(token => token.ticker === amount.tokenTicker);
  if (!match) throw Error(`unknown ticker: ${amount.tokenTicker}`);
  if (match.fractionalDigits !== amount.fractionalDigits) {
    throw new Error(
      "Mismatch in fractional digits between token and value. If you really want, implement a conversion here. However, this indicates a bug in the caller code.",
    );
  }
  return {
    denom: match.denom,
    amount: amount.quantity,
  };
}

export function encodeFee(fee: Fee, tokens: BankTokens): types.StdFee {
  if (fee.tokens === undefined) {
    throw new Error("Cannot encode fee without tokens");
  }
  if (fee.gasLimit === undefined) {
    throw new Error("Cannot encode fee without gas limit");
  }
  return {
    amount: [amountToBankCoin(fee.tokens, tokens)],
    gas: fee.gasLimit,
  };
}

export function encodeFullSignature(fullSignature: FullSignature): types.StdSignature {
  switch (fullSignature.pubkey.algo) {
    case Algorithm.Secp256k1:
      return encodeSecp256k1Signature(fullSignature.pubkey.data, fullSignature.signature);
    default:
      throw new Error("Unsupported signing algorithm");
  }
}

export function buildUnsignedTx(
  tx: UnsignedTransaction,
  bankTokens: BankTokens,
  erc20Tokens: readonly Erc20Token[] = [],
): types.AminoTx {
  if (!isSendTransaction(tx)) {
    throw new Error("Received transaction of unsupported kind");
  }

  const matchingBankToken = bankTokens.find(t => t.ticker === tx.amount.tokenTicker);
  const matchingErc20Token = erc20Tokens.find(t => t.ticker === tx.amount.tokenTicker);

  if (matchingBankToken) {
    return {
      type: "cosmos-sdk/StdTx",
      value: {
        msg: [
          {
            type: "cosmos-sdk/MsgSend",
            value: {
              from_address: tx.sender,
              to_address: tx.recipient,
              amount: [amountToBankCoin(tx.amount, bankTokens)],
            },
          },
        ],
        memo: tx.memo || "",
        signatures: [],
        fee: tx.fee
          ? encodeFee(tx.fee, bankTokens)
          : {
              amount: [],
              gas: "",
            },
      },
    };
  } else if (matchingErc20Token) {
    return {
      type: "cosmos-sdk/StdTx",
      value: {
        msg: [
          {
            type: "wasm/execute",
            value: {
              sender: tx.sender,
              contract: matchingErc20Token.contractAddress,
              msg: {
                transfer: {
                  amount: tx.amount.quantity,
                  recipient: tx.recipient,
                },
              },
              sent_funds: [],
            },
          },
        ],
        memo: tx.memo || "",
        signatures: [],
        fee: tx.fee
          ? encodeFee(tx.fee, bankTokens)
          : {
              amount: [],
              gas: "",
            },
      },
    };
  } else {
    throw new Error("Cannot encode this type of transaction");
  }
}

export function buildSignedTx(
  tx: SignedTransaction,
  bankTokens: BankTokens,
  erc20Tokens: readonly Erc20Token[] = [],
): types.AminoTx {
  const built = buildUnsignedTx(tx.transaction, bankTokens, erc20Tokens);
  return {
    ...built,
    value: {
      ...built.value,
      signatures: tx.signatures.map(encodeFullSignature),
    },
  };
}
