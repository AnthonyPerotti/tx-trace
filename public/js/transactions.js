function initTransactionForm(initialState) {
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
}
