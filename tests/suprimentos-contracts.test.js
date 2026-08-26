const assert = require('assert');
const contracts = require('../suprimentos/contracts/entities.v1.json');
const domain = require('../suprimentos/core/contracts');

function reservation(overrides) {
  return Object.assign({
    Reserva_ID: 'res-1', Necessidade_ID: 'nec-1', Material_ID: 'mat-1', Quantidade: 2,
    Tipo: 'RESERVA', Documento_ID: 'doc-1', Documento_Versao: 1, Item_ID: 'item-1',
    Idempotency_Key: 'idem-1', Correlation_ID: 'corr-1', Row_Version: 0,
    Created_At: '2026-08-24T00:00:00Z'
  }, overrides || {});
}

(function contractContainsCanonicalEntities() {
  [
    'Necessidades_Materiais', 'Reservas_Estoque', 'Movimentacoes_Estoque',
    'Estoque_Projetado', 'Eventos_Integracao', 'Parametros_Alcadas'
  ].forEach((entity) => assert.ok(contracts.entities[entity], entity));
  assert.strictEqual(contracts.entities.Reservas_Estoque.appendOnly, true);
  assert.strictEqual(contracts.entities.Estoque_Projetado.sourceOfTruth, false);
})();

(function supDat001RejectsDuplicateIdempotencyKey() {
  const first = reservation();
  const second = reservation({ Reserva_ID: 'res-2' });
  assert.throws(
    () => domain.assertUnique(contracts, 'Reservas_Estoque', [first, second]),
    (error) => error.code === 'UNIQUE_CONSTRAINT_VIOLATION' && error.details.rule === 'Idempotency_Key'
  );
})();

(function supDat002RejectsDescriptionAsRelationKey() {
  const invalid = {
    Necessidade_ID: 'nec-1', Projeto_ID: 'proj-1', Item_ID: 'item-1',
    Material_Descricao: 'Cabo 4 mm²', Origem_Material: 'ELETRIUM',
    Quantidade_Planejada: 10, Quantidade_Atendida: 0, Unidade: 'm',
    Data_Necessaria: '2026-09-01', Criticidade: 'NORMAL', Snapshot_Versao: 1,
    Row_Version: 0, Status: 'PENDENTE', Created_At: '2026-08-24T00:00:00Z',
    Updated_At: '2026-08-24T00:00:00Z'
  };
  assert.throws(
    () => domain.validateEntity(contracts, 'Necessidades_Materiais', invalid),
    (error) => error.code === 'Material_ID_REQUIRED'
  );
})();

(function supDat003RejectsStaleRowVersion() {
  const current = { Necessidade_ID: 'nec-1', Row_Version: 4, Status: 'PENDENTE' };
  assert.throws(
    () => domain.conditionalUpdate(current, { Status: 'ATENDIDA' }, 3),
    (error) => error.code === 'ROW_VERSION_CONFLICT' && error.details.actual === 4
  );
  assert.deepStrictEqual(
    domain.conditionalUpdate(current, { Status: 'ATENDIDA' }, 4),
    { Necessidade_ID: 'nec-1', Row_Version: 5, Status: 'ATENDIDA' }
  );
})();

async function supDat004PaginationIsCompleteOrExplicitError() {
  const pages = {
    first: { items: [{ id: 1 }, { id: 2 }], hasMore: true, nextCursor: 'next' },
    next: { items: [{ id: 3 }], hasMore: false }
  };
  const complete = await domain.readAllPages((cursor) => Promise.resolve(pages[cursor || 'first']));
  assert.deepStrictEqual(complete, { items: [{ id: 1 }, { id: 2 }, { id: 3 }], pages: 2, complete: true });

  await assert.rejects(
    () => domain.readAllPages(() => Promise.resolve({ items: [{ id: 1 }], hasMore: true })),
    (error) => error.code === 'PAGINATION_INCOMPLETE'
  );
}

(function supDat005ProjectionDivergenceIsReconciliable() {
  const rebuilt = {
    'mat-1': {
      Estoque_Fisico: 10, Reservado_Valido: 3, Disponivel: 7,
      Projection_Version: 4, Ultimo_Movimento_ID: 'mov-9'
    }
  };
  const stored = {
    'mat-1': {
      Estoque_Fisico: 10, Reservado_Valido: 1, Disponivel: 9,
      Projection_Version: 3, Ultimo_Movimento_ID: 'mov-8'
    }
  };
  const result = domain.compareProjection(rebuilt, stored);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.differences.map((item) => item.field), [
    'Reservado_Valido', 'Disponivel', 'Projection_Version', 'Ultimo_Movimento_ID'
  ]);
  assert.deepStrictEqual(result.replacement, rebuilt);
})();

(async function main() {
  await supDat004PaginationIsCompleteOrExplicitError();
  assert.strictEqual(domain.validateEntity(contracts, 'Reservas_Estoque', reservation()), true);
  console.log('suprimentos-contracts.test.js: OK — SUP-DAT-001 a SUP-DAT-005');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
