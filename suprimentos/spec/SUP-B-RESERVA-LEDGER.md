# SUP-B — Reserva transacional e ledger

## Objetivo
Implementar a semântica P0 de reserva sem depender de CRM ou OS.

## Fluxo de reserva
1. Receber comando com Documento_ID, Versao, itens e Idempotency_Key.
2. Validar todos os itens antes de qualquer efeito persistente.
3. Calcular disponibilidade = físico - reservas válidas.
4. Se política exigir atendimento integral e algum item faltar, não efetivar nenhum item.
5. Persistir eventos de reserva append-only com Correlation_ID comum.
6. Atualizar projeção de estoque somente após persistência do ledger.
7. Em falha após efeito parcial, registrar COMPENSACAO; nunca apagar registros.

## Estados por item
PENDENTE | RESERVADO | PARCIAL | FALTA | CONSUMIDO | LIBERADO | CANCELADO

## Concorrência
- Escritas condicionais por Row_Version/ETag ou serialização equivalente.
- O último saldo não pode ser reservado duas vezes.
- Retry do mesmo comando deve devolver o resultado anterior, sem duplicar ledger.

## Operações
- reserve(command)
- release(command)
- consume(command)
- compensate(command)
- deriveAvailability(materialId)
- reconcile(materialId)

## Contrato implementado no núcleo

`suprimentos/core/ledger.js` é UMD e não conhece tela, SharePoint, CRM, OS ou Bom Controle.
Cada operação recebe um estado imutável e devolve `{ state, result, replayed }`.

- `expectedVersions` é obrigatório por `Material_ID` tocado. O adapter persistente deve
  mapear esse valor para `Row_Version`, ETag/If-Match ou CAS equivalente.
- a verificação de idempotência ocorre antes da verificação de versão: retry do mesmo
  comando devolve o resultado já confirmado, ainda que a versão tenha avançado;
- reutilizar a mesma chave com payload diferente é erro explícito
  `IDEMPOTENCY_KEY_REUSED`, nunca replay silencioso;
- um comando multiproduto é pré-validado integralmente antes do commit;
- `release()` acrescenta `LIBERACAO`, sem apagar `RESERVA`;
- `consume()` acrescenta `CONSUMO` no ledger de reservas e `SAIDA` no ledger de
  movimentações no mesmo commit lógico;
- `compensate()` referencia os eventos originais por `compensatesEventId` e aplica o
  delta inverso. Para desfazer consumo completo, o comando deve referenciar tanto o
  evento `CONSUMO` quanto seu evento `SAIDA`;
- `rebuildProjection()` recompõe físico, reservado, disponível, versão da projeção e
  último movimento a partir do saldo de abertura imutável e dos ledgers;
- `reconcile()` compara a projeção persistida com a reconstruída e retorna diferenças
  explícitas por material/campo. Não corrige ou oculta divergência automaticamente.

O estado em memória é a implementação de referência para testes. Em produção, o adapter
deverá realizar o commit dos dois ledgers e da versão com escrita condicional. Nenhuma
chamada produtiva foi introduzida nesta frente.

## Invariantes
- saldo disponível nunca pode ficar negativo por corrida;
- reserva não altera estoque físico;
- consumo gera movimento de saída e encerra quantidade correspondente da reserva;
- liberação não apaga reserva anterior;
- compensação é evento explícito;
- projeção pode ser reconstruída integralmente pelos ledgers.

## Testes Gate B
- TS-11: reserva integral com saldo suficiente.
- TS-12: conjunto multiproduto falha sem efeito parcial indevido.
- TS-13: falta explícita e rastreável.
- TS-14: retry idempotente.
- TS-15: concorrência no último saldo.
- TS-56: compensação de falha parcial preserva trilha.

Além dos gates formais, a suíte cobre `release()`, `consume()`, reconstrução integral e
reconciliação de projeção divergente.

## Adapters e falhas combinadas

- `adapters/in-memory-ledger-store.js`: referência transacional e injeção controlada de
  falhas antes/depois do commit e após escrita parcial;
- `adapters/sharepoint-ledger-adapter.js`: porta injetável que exige leitura completa,
  idempotência e `commitAtomic` com ETags;
- `core/reconciliation.js`: detecta projeção divergente e consumo sem movimento, gera
  plano de reparo e rascunhos de `RECONCILIACAO_PENDENTE`;
- `tests/suprimentos-adapters-faults.test.js`: perda de ACK, ETag 412, paginação
  incompleta e falha parcial sem silêncio.

O adapter SharePoint real permanece não configurado; somente o contrato foi implementado.

## Porta Graph e escritor único

- `adapters/sharepoint-graph-client.js` implementa a porta HTTP injetável para Microsoft
  Graph, obtém credencial exclusivamente por provider em runtime, percorre `nextLink`
  integralmente e envia `If-Match` nas atualizações condicionais. Não contém URL de
  tenant, segredo ou transporte produtivo;
- `adapters/single-writer-coordinator.js` serializa comandos no processo do service
  account e deixa explícito que SharePoint não oferece transação ACID entre listas;
- antes do ledger, ETags são validados. Depois do primeiro append, qualquer falha gera
  `LEDGER_PARTIAL_EFFECT` e erro `PERSISTENCE_PARTIAL_RECONCILIATION_REQUIRED`; registros
  não são apagados e a reconciliação fica obrigatória e observável;
- uma implantação horizontal ainda deve usar lease/fila externa de consumidor único.
  O serializador em processo é a referência de semântica, não um lock distribuído.

`adapters/sharepoint-repository.js` completa o mapeamento físico de reservas,
movimentações, projeção e eventos de integração, preservando campos de compensação e
reconstrução. `core/outbox-worker.js` e `adapters/in-memory-outbox-store.js` definem o
consumer com lease, backoff e limite de retry. Efeito externo incerto vai para
`RECONCILIATION_PENDING`; não há retry cego depois de timeout de envio.

`adapters/sharepoint-lease-store.js` implementa lease distribuído com ETag e fencing
token; um worker antigo não pode liberar ou renovar o lease assumido por outro.
`adapters/sharepoint-homologation.js` executa captura de schema e paginação em modo
somente leitura, exigindo uma segunda trava explícita para o probe de escrita condicional.

## Não colisão
Nenhuma alteração em código de CRM/OS. Persistência fica atrás de adapter próprio `suprimentos/*`; integração com telas atuais só ocorre após Gate A e revisão de conflito.
