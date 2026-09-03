function handleSourceChange() {
  const sourceSelect = document.getElementById('payment_source');
  const sourceNotice = document.getElementById('sourceNotice');
  const institutionSelect = document.getElementById('institution_id');

  if (!sourceSelect || !sourceNotice) return;

  if (sourceSelect.value === 'credit_card') {
    sourceNotice.innerHTML = '<strong style="color:var(--expense)">Atenção:</strong> O valor consumirá o <strong>limite do cartão de crédito</strong> selecionado. Não impactará o saldo da sua conta bancária imediatamente.';
    
    // Auto-select first credit card if available
    if (institutionSelect) {
      for (let i = 0; i < institutionSelect.options.length; i++) {
        if (institutionSelect.options[i].dataset.type === 'credit_card') {
          institutionSelect.selectedIndex = i;
          break;
        }
      }
    }
  } else {
    sourceNotice.innerHTML = '<span style="color:var(--info)">Saída direta de conta corrente / Pix / dinheiro. Impactará o saldo imediatamente.</span>';
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
      profitText.innerHTML = `Rendimento extra estimado: <strong>R$ ${profit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong> (+${((profit / principal) * 100).toFixed(1)}%)`;
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

document.addEventListener('DOMContentLoaded', () => {
  handleSourceChange();
  calculateDifference();
});
