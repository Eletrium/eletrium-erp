(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosComponents = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function esc(value) { return String(value === undefined || value === null ? '' : value).replace(/[&<>'"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]; }); }
  function inventoryCard(vm) {
    return '<section class="sup-card" data-material-id="' + esc(vm.materialId) + '"><h3>Estoque projetado</h3>' +
      '<dl><dt>Físico</dt><dd>' + esc(vm.physical) + '</dd><dt>Reservado</dt><dd>' + esc(vm.reserved) + '</dd><dt>Disponível</dt><dd>' + esc(vm.available) + '</dd></dl>' +
      '<p role="status" data-state="' + esc(vm.severity) + '">' + (vm.reconciled ? 'Reconciliado' : 'Reconciliação obrigatória') + '</p></section>';
  }
  function conflictDialog(vm) {
    return '<section role="alertdialog" aria-modal="true" aria-labelledby="sup-conflict-title"><h3 id="sup-conflict-title">Conflito de versão</h3>' +
      '<p>O saldo foi alterado por outro comando. Recarregue os dados antes de tentar novamente.</p><code>' + esc(vm.code) + '</code><button type="button" data-command="reload">Recarregar</button></section>';
  }
  function queueTable(vm) {
    var rows = vm.items.map(function (item) { return '<tr><td>' + esc(item.id) + '</td><td>' + esc(item.category) + '</td><td>' + esc(item.criticality) + '</td><td>' + esc(item.action) + '</td></tr>'; }).join('');
    return '<section class="sup-queue"><h3>Exceções abertas (' + esc(vm.totals.open) + ')</h3><table><thead><tr><th>ID</th><th>Categoria</th><th>Criticidade</th><th>Ação</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
  }
  return { escape: esc, inventoryCard: inventoryCard, conflictDialog: conflictDialog, queueTable: queueTable };
});
