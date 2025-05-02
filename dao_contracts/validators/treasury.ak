use cardano/transaction.{OutputReference, Transaction}

validator treasury {
  spend(
    _datum_opt: Option<Data>,
    _redeemer: Data,
    _utxo: OutputReference,
    _self: Transaction,
  ) {
    True
  }

  else(_) {
    fail
  }
}
