import { applyParamsToScript, mTxOutRef } from "@meshsdk/core";
import plutusJson from "@/lib/scripts/plutus.json";

// Find the token minting policy in the compiled validators
const tokenMintingValidator = plutusJson.validators.find(
  (v) => v.title === "token_minting_policy.token_minting_policy.mint"
);

if (!tokenMintingValidator) {
  throw new Error("Token minting policy not found in plutus.json");
}

const COMPILED_TOKEN_MINTING_POLICY = tokenMintingValidator.compiledCode;

export function createTokenMintingScript(
  initialUtxoTxHash: string,
  initialUtxoIndex: number,
  authorizedMinterKeyHash: string
) {
  const initialUtxoRef = mTxOutRef(initialUtxoTxHash, initialUtxoIndex);

  return applyParamsToScript(COMPILED_TOKEN_MINTING_POLICY, [
    initialUtxoRef,
    authorizedMinterKeyHash,
  ]);
}

export const INITIAL_MINT_REDEEMER = {
  data: {
    alternative: 0,
    fields: [
      {
        alternative: 0,
        fields: [],
      },
    ],
  },
  tag: "MINT" as const,
};
