// ─── Form: switch between investment types ────────────────────────────────────

function switchType(type) {
  const fieldsFixed = document.getElementById('fieldsFixed');
  const fieldsVar   = document.getElementById('fieldsVar');
  const tabFixed    = document.getElementById('tabFixed');
  const tabVar      = document.getElementById('tabVar');

  if (!fieldsFixed) return; // not on form page

  if (type === 'fixed_income') {
    fieldsFixed.style.display = '';
    fieldsVar.style.display   = 'none';
    tabFixed?.classList.add('active');
    tabVar?.classList.remove('active');

    // Disable variable-only fields so they don't submit garbage
    ['inv_asset_class', 'inv_ticker', 'inv_quantity', 'inv_avg_price', 'inv_current_price'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
    ['inv_rate_type', 'inv_rate_value', 'inv_maturity', 'inv_current_amount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
  } else {
    fieldsFixed.style.display = 'none';
    fieldsVar.style.display   = '';
    tabFixed?.classList.remove('active');
    tabVar?.classList.add('active');

    ['inv_rate_type', 'inv_rate_value', 'inv_maturity', 'inv_current_amount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
    ['inv_asset_class', 'inv_ticker', 'inv_quantity', 'inv_avg_price', 'inv_current_price'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
  }
}

// ─── Form: update rate label based on selected rate type ─────────────────────

function updateRateLabel() {
  const sel   = document.getElementById('inv_rate_type');
  const label = document.getElementById('rateValueLabel');
  if (!sel || !label) return;

  const labels = {
    pre:      'Taxa Pré-fixada (% a.a.)',
    pos_cdi:  'Percentual do CDI (%)',
    pos_ipca: 'Spread IPCA+ (% a.a.)',
    pos_selic:'Spread Selic+ (% a.a.)',
    '':       'Valor da Taxa'
  };
  label.textContent = labels[sel.value] || 'Valor da Taxa';
}

// ─── Ticker input: auto uppercase ─────────────────────────────────────────────

(function () {
  const tickerInput = document.getElementById('inv_ticker');
  if (tickerInput) {
    tickerInput.addEventListener('input', () => {
      const pos = tickerInput.selectionStart;
      tickerInput.value = tickerInput.value.toUpperCase();
      tickerInput.setSelectionRange(pos, pos);
    });
  }
})();

// ─── Quick price update modal ─────────────────────────────────────────────────

let _priceModalId   = null;
let _priceModalType = null;

function openPriceModal(id, type, currentVal) {
  _priceModalId   = id;
  _priceModalType = type;

  const modal = document.getElementById('priceModal');
  const form  = document.getElementById('priceForm');
  const input = document.getElementById('priceInput');
  const label = document.getElementById('priceLabel');

  if (!modal) return;

  if (type === 'variable_income') {
    form.action  = `/investments/${id}/update-price`;
    input.name   = 'current_price';
    label.textContent = 'Preço atual por cota/unidade (R$)';
  } else {
    form.action  = `/investments/${id}/update-price`;
    input.name   = 'current_amount';
    label.textContent = 'Valor atual do investimento (R$)';
  }

  input.value = currentVal || '';
  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 100);
}

function closePriceModal() {
  const modal = document.getElementById('priceModal');
  if (modal) modal.style.display = 'none';
}

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePriceModal();
});
