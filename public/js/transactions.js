let originalInstitutionOptions = [];

function initTransactionForm(initialState) {
  const instSelect = document.getElementById('institution_id');
  if (instSelect) {
    originalInstitutionOptions = Array.from(instSelect.options).map(opt => ({
      value: opt.value,
      text: opt.text,
      type: opt.dataset.type || '',
      color: opt.dataset.color || '',
      typeLabel: opt.dataset.typeLabel || '',
      selected: opt.selected
    }));
  }

  setType(initialState.type || 'expense');
  setMethod(initialState.paymentMethod || 'pix');

  const categorySelect = document.getElementById('category_id');
  const isRecurringInput = document.getElementById('isRecurring');
  const isInstallmentInput = document.getElementById('isInstallment');
  const installmentFields = document.getElementById('installmentFields');

  if (categorySelect && isRecurringInput) {
    categorySelect.addEventListener('change', function() {
      const selectedOption = categorySelect.options[categorySelect.selectedIndex];
      const text = selectedOption ? selectedOption.textContent.toLowerCase() : '';
      if (text.includes('assinatura')) {
        isRecurringInput.checked = true;
        if (isInstallmentInput && isInstallmentInput.checked) {
          isInstallmentInput.checked = false;
          if (installmentFields) installmentFields.classList.add('hidden');
        }
      }
    });
  }

  if (isInstallmentInput && installmentFields) {
    isInstallmentInput.addEventListener('change', function() {
      if (this.checked) {
        installmentFields.classList.remove('hidden');
        setMethod('credit');
        if (isRecurringInput) isRecurringInput.checked = false;
      } else {
        installmentFields.classList.add('hidden');
      }
    });
  }

  if (isRecurringInput && isInstallmentInput) {
    isRecurringInput.addEventListener('change', function() {
      if (this.checked) {
        isInstallmentInput.checked = false;
        if (installmentFields) installmentFields.classList.add('hidden');
      }
    });
  }

  updateInstitutionVisual();
}

function setType(type) {
  const typeInput = document.getElementById('typeInput');
  if (typeInput) typeInput.value = type;

  const btnIncome = document.querySelector('.type-btn.income');
  const btnExpense = document.querySelector('.type-btn.expense');

  if (btnIncome && btnExpense) {
    if (type === 'income') {
      btnIncome.classList.add('active');
      btnExpense.classList.remove('active');
    } else {
      btnExpense.classList.add('active');
      btnIncome.classList.remove('active');
    }
  }
}

function setMethod(method) {
  const methodInput = document.getElementById('paymentMethodInput');
  if (methodInput) methodInput.value = method;

  const methods = ['debit', 'credit', 'pix', 'cash'];
  methods.forEach(m => {
    const btn = document.getElementById(`btn-${m}`);
    if (btn) {
      if (m === method) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    }
  });

  filterInstitutionsByMethod(method);
}

function filterInstitutionsByMethod(method) {
  const instSelect = document.getElementById('institution_id');
  if (!instSelect || originalInstitutionOptions.length === 0) return;

  const currentVal = instSelect.value;
  instSelect.innerHTML = '';

  let allowedTypes = [];
  if (method === 'credit') {
    allowedTypes = ['credit_card'];
  } else {
    // debit, pix, cash
    allowedTypes = ['bank', 'digital_wallet'];
  }

  let valueStillAvailable = false;

  originalInstitutionOptions.forEach(optData => {
    // Option vazia "Sem conta específica" sempre permitida
    if (!optData.value || allowedTypes.includes(optData.type)) {
      const option = document.createElement('option');
      option.value = optData.value;
      option.textContent = optData.text;
      option.dataset.type = optData.type;
      option.dataset.color = optData.color;
      option.dataset.typeLabel = optData.typeLabel;

      if (optData.value === currentVal) {
        option.selected = true;
        valueStillAvailable = true;
      }
      instSelect.appendChild(option);
    }
  });

  if (!valueStillAvailable) {
    instSelect.selectedIndex = 0;
  }

  updateInstitutionVisual();
}

function updateInstitutionVisual() {
  const instSelect = document.getElementById('institution_id');
  const instCard = document.getElementById('instCard');
  const instTypeBadge = document.getElementById('instTypeBadge');
  const instColorIndicator = document.getElementById('instColorIndicator');
  if (!instSelect) return;

  const selectedOption = instSelect.options[instSelect.selectedIndex];
  if (!selectedOption || !selectedOption.value) {
    if (instCard) instCard.style.borderLeftColor = 'transparent';
    if (instColorIndicator) instColorIndicator.style.background = 'var(--border-default)';
    if (instTypeBadge) instTypeBadge.textContent = '';
    return;
  }

  const color = selectedOption.dataset.color || 'var(--primary)';
  const typeLabel = selectedOption.dataset.typeLabel || '';

  if (instCard) instCard.style.borderLeftColor = color;
  if (instColorIndicator) instColorIndicator.style.background = color;
  if (instTypeBadge) {
    instTypeBadge.textContent = typeLabel;
    instTypeBadge.style.color = color;
  }
}
