// ─── Loan form JS ─────────────────────────────────────────────────────────────

// Cache all institution options on init for filtering
let _allLoanInstitutions = [];

document.addEventListener('DOMContentLoaded', () => {
  const instSelect = document.getElementById('institution_id');
  if (instSelect) {
    _allLoanInstitutions = Array.from(instSelect.options).map(opt => ({
      value: opt.value,
      text: opt.text,
      type: opt.dataset.type || '',
      selected: opt.selected
    }));
  }

  // Check initial direction (edit mode or default)
  const checkedDirRadio = document.querySelector('input[name="loan_direction"]:checked');
  if (checkedDirRadio) {
    setLoanDirection(checkedDirRadio.value);
  } else {
    handleSourceChange();
    calculateDifference();
  }

  // Pre-fill return amount if principal already has value (edit mode)
  const principal = document.getElementById('principal_amount');
  const returnAmt = document.getElementById('total_return_amount');
  if (principal && returnAmt && principal.value && !returnAmt.value) {
    returnAmt.value = principal.value;
    calculateDifference();
  }
});

/**
 * Toggles form mode between 'given' (lent money to someone) and 'received' (borrowed from bank/creditor)
 */
function setLoanDirection(dir) {
  const dirGivenLabel    = document.getElementById('dirGivenLabel');
  const dirReceivedLabel = document.getElementById('dirReceivedLabel');
  const givenSections    = document.querySelectorAll('.loan-given-section');
  const receivedSections = document.querySelectorAll('.loan-received-section');
  const borrowerInput    = document.getElementById('borrower_name');
  const creditorInput    = document.getElementById('creditor_name');
  const sourceGroup      = document.getElementById('paymentSourceGroup');

  const radios = document.querySelectorAll('input[name="loan_direction"]');
  radios.forEach(r => {
    r.checked = (r.value === dir);
  });

  if (dir === 'received') {
    if (dirReceivedLabel) dirReceivedLabel.classList.add('active');
    if (dirGivenLabel)    dirGivenLabel.classList.remove('active');

    givenSections.forEach(el => el.classList.add('hidden'));
    receivedSections.forEach(el => el.classList.remove('hidden'));

    if (borrowerInput) borrowerInput.required = false;
    if (creditorInput) creditorInput.required = true;
    if (sourceGroup)   sourceGroup.classList.add('hidden');

    // Only allow bank accounts (not cards) for receiving funds
    filterInstitutionsOnlyBanks();
    calculateReceivedLoan();
  } else {
    if (dirGivenLabel)    dirGivenLabel.classList.add('active');
    if (dirReceivedLabel) dirReceivedLabel.classList.remove('active');

    givenSections.forEach(el => el.classList.remove('hidden'));
    receivedSections.forEach(el => el.classList.add('hidden'));

    if (borrowerInput) borrowerInput.required = true;
    if (creditorInput) creditorInput.required = false;
    if (sourceGroup)   sourceGroup.classList.remove('hidden');

    handleSourceChange();
    calculateDifference();
  }
}

/**
 * Toggles parallel interest return fields
 */
function toggleInterestReturnFields(checked) {
  const fields = document.getElementById('interestReturnFields');
  if (fields) {
    if (checked) fields.classList.remove('hidden');
    else fields.classList.add('hidden');
  }
}

/**
 * Auto-fills the return amount when the user types in the principal field,
 * but only if the return field hasn't been manually modified.
 */
function autoFillReturn(principalValue) {
  const returnInput = document.getElementById('total_return_amount');
  if (returnInput && !returnInput.dataset.manuallyEdited) {
    returnInput.value = principalValue || '';
  }
  calculateDifference();
  calculateReceivedLoan();
}

// Mark the return field as manually edited when user types in it directly
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const returnInput = document.getElementById('total_return_amount');
    if (returnInput) {
      returnInput.addEventListener('input', () => {
        returnInput.dataset.manuallyEdited = '1';
        calculateDifference();
      });
    }

    const withInterestInput = document.getElementById('total_with_interest');
    if (withInterestInput) {
      withInterestInput.addEventListener('input', () => {
        withInterestInput.dataset.manuallyEdited = '1';
        calculateReceivedLoan();
      });
    }
  });
})();

/**
 * Filters the institution dropdown to only bank accounts (for received loans)
 */
function filterInstitutionsOnlyBanks() {
  const institutionSelect = document.getElementById('institution_id');
  if (!institutionSelect || _allLoanInstitutions.length === 0) return;

  const currentVal = institutionSelect.value;
  institutionSelect.innerHTML = '';

  const allowedTypes = ['bank', 'digital_wallet', ''];
  let firstMatch = null;
  let valueStillAvailable = false;

  _allLoanInstitutions.forEach(optData => {
    if (!optData.value || allowedTypes.includes(optData.type)) {
      const opt = document.createElement('option');
      opt.value = optData.value;
      opt.textContent = optData.text;
      opt.dataset.type = optData.type;

      if (optData.value === currentVal) {
        opt.selected = true;
        valueStillAvailable = true;
      }
      institutionSelect.appendChild(opt);
      if (optData.value && !firstMatch) firstMatch = opt;
    }
  });

  if (!valueStillAvailable && firstMatch) {
    firstMatch.selected = true;
  }
}

/**
 * Filters the institution dropdown based on the selected payment source (for given loans).
 */
function handleSourceChange() {
  const sourceSelect = document.getElementById('payment_source');
  const sourceNotice = document.getElementById('sourceNotice');
  const institutionSelect = document.getElementById('institution_id');

  if (!sourceSelect) return;

  const source = sourceSelect.value;

  if (sourceNotice) {
    if (source === 'credit_card') {
      sourceNotice.innerHTML = '<strong style="color:var(--expense)">Atenção:</strong> O valor consumirá o <strong>limite do cartão de crédito</strong> selecionado. Não impactará o saldo da sua conta bancária imediatamente.';
    } else {
      sourceNotice.innerHTML = '<span style="color:var(--info)">Saída direta de conta corrente / Pix / dinheiro. Impactará o saldo imediatamente.</span>';
    }
  }

  // Filter institution dropdown by type
  if (institutionSelect && _allLoanInstitutions.length > 0) {
    const currentVal = institutionSelect.value;
    institutionSelect.innerHTML = '';

    const allowedTypes = source === 'credit_card'
      ? ['credit_card']
      : ['bank', 'digital_wallet', ''];

    let firstMatch = null;
    let valueStillAvailable = false;

    _allLoanInstitutions.forEach(optData => {
      if (!optData.value || allowedTypes.includes(optData.type)) {
        const opt = document.createElement('option');
        opt.value = optData.value;
        opt.textContent = optData.text;
        opt.dataset.type = optData.type;

        if (optData.value === currentVal) {
          opt.selected = true;
          valueStillAvailable = true;
        }
        institutionSelect.appendChild(opt);
        if (optData.value && !firstMatch) firstMatch = opt;
      }
    });

    if (!valueStillAvailable) {
      if (firstMatch) firstMatch.selected = true;
      else institutionSelect.selectedIndex = 0;
    }
  }
}

function calculateDifference() {
  const principalInput = document.getElementById('principal_amount');
  const returnInput = document.getElementById('total_return_amount');
  const outInstInput = document.getElementById('total_installments');
  const inInstInput = document.getElementById('return_total_installments');

  const profitCard = document.getElementById('profitCard');
  const profitText = document.getElementById('profitText');
  const diffWarning = document.getElementById('diffInstallmentWarning');
  const diffText = document.getElementById('diffInstallmentText');

  const principal = parseFloat(principalInput?.value || 0);
  const returnVal = parseFloat(returnInput?.value || 0);

  if (returnVal > principal && principal > 0) {
    const profit = returnVal - principal;
    if (profitCard && profitText) {
      profitText.innerHTML = `Rendimento extra estimado: <strong>R$ ${profit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (+${((profit / principal) * 100).toFixed(1)}%)`;
      profitCard.classList.remove('hidden');
    }
  } else {
    if (profitCard) profitCard.classList.add('hidden');
  }

  const outInst = parseInt(outInstInput?.value || 1);
  const inInst = parseInt(inInstInput?.value || 1);

  if (outInst !== inInst && inInst > 0 && outInst > 0) {
    if (diffWarning && diffText) {
      diffText.innerHTML = `Estrutura flexível: Você financia em <strong>${outInst}x</strong> e receberá de volta em <strong>${inInst}x</strong>.`;
      diffWarning.classList.remove('hidden');
    }
  } else {
    if (diffWarning) diffWarning.classList.add('hidden');
  }
}

/**
 * Calculates total and installment estimate for received bank loans
 */
function calculateReceivedLoan() {
  const principalInput = document.getElementById('principal_amount');
  const rateInput = document.getElementById('interest_rate');
  const rateTypeSelect = document.getElementById('interest_rate_type');
  const installmentsInput = document.getElementById('total_installments');
  const withInterestInput = document.getElementById('total_with_interest');
  const estimateNotice = document.getElementById('receivedInstallmentEstimate');

  if (!principalInput || !installmentsInput) return;

  const principal = parseFloat(principalInput.value || 0);
  const installments = Math.max(1, parseInt(installmentsInput.value) || 1);
  const rate = parseFloat(rateInput?.value || 0);
  const rateType = rateTypeSelect?.value || 'monthly';

  let totalPayable = principal;

  // Auto-calculate total if user hasn't manually edited total_with_interest
  if (withInterestInput && !withInterestInput.dataset.manuallyEdited) {
    if (rate > 0 && principal > 0) {
      if (rateType === 'monthly') {
        // Simple approximation for bank loans: principal * (1 + rate/100 * months)
        totalPayable = principal * (1 + (rate / 100) * installments);
      } else if (rateType === 'annual') {
        totalPayable = principal * (1 + (rate / 100) * (installments / 12));
      } else {
        // total / fixed rate
        totalPayable = principal * (1 + rate / 100);
      }
      withInterestInput.value = totalPayable.toFixed(2);
    } else {
      withInterestInput.value = principal > 0 ? principal.toFixed(2) : '';
    }
  } else if (withInterestInput && withInterestInput.value) {
    totalPayable = parseFloat(withInterestInput.value) || principal;
  }

  const perInstallment = totalPayable / installments;

  if (estimateNotice) {
    if (totalPayable > 0) {
      estimateNotice.innerHTML = `Estimativa de Pagamento: <strong>${installments}x de R$ ${perInstallment.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (Total: R$ ${totalPayable.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      estimateNotice.classList.remove('hidden');
    } else {
      estimateNotice.classList.add('hidden');
    }
  }
}
