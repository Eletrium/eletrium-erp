# SUP-A — Dados, schema e contratos

## Objetivo
Estabelecer o contrato canônico do módulo Suprimentos sem alterar CRM ou OS.

## Entidades P0

### Necessidades_Materiais
- Necessidade_ID (UUID, imutável)
- Projeto_ID
- EAP_ID/Pacote_ID
- OS_ID (opcional enquanto não liberada)
- Item_ID
- Material_ID
- Origem_Material: ELETRIUM | CLIENTE | MISTA
- Quantidade_Planejada
- Quantidade_Atendida
- Unidade
- Data_Necessaria
- Criticidade
- Snapshot_Versao
- Row_Version
- Status
- Created_At / Updated_At

### Reservas_Estoque
Ledger por documento/versão/item.
- Reserva_ID
- Necessidade_ID
- Material_ID
- Quantidade
- Tipo: RESERVA | LIBERACAO | CONSUMO | COMPENSACAO
- Documento_ID
- Documento_Versao
- Item_ID
- Idempotency_Key (única)
- Correlation_ID
- Row_Version
- Created_At

### Movimentacoes_Estoque
Ledger imutável.
- Movimento_ID
- Material_ID
- Tipo: ENTRADA | SAIDA | AJUSTE | DEVOLUCAO | TRANSFERENCIA
- Quantidade
- Origem_ID
- Destino_ID
- Documento_ID
- Documento_Versao
- Item_ID
- Idempotency_Key (única)
- Correlation_ID
- Created_At

### Estoque_Projetado
Projeção derivada e reconciliável; nunca fonte primária.
- Material_ID
- Estoque_Fisico
- Reservado_Valido
- Disponivel
- Ultimo_Movimento_ID
- Projection_Version
- Reconciled_At

### Eventos_Integracao
- Evento_ID
- Entidade
- Entity_ID
- Sequence
- Idempotency_Key
- Correlation_ID
- Origem
- Destino
- Status: LOCAL_PENDING | QUEUED | SENDING | RECEIVED | SYNCED | RECONCILED | SYNC_ERROR | CANCELLED
- Teto_Excedido
- Retry_Count
- Payload_Version
- Created_At / Updated_At

## Regras de integridade
1. IDs, nunca descrições, formam relacionamentos.
2. Idempotency_Key é obrigatória em toda escrita crítica.
3. Ledger é append-only; correção ocorre por evento compensatório.
4. Origem ELETRIUM, CLIENTE e MISTA não compartilha custo/propriedade implicitamente.
5. Campo agregado de estoque é projeção, nunca verdade operacional.
6. Escrita deve exigir Row_Version/ETag quando houver concorrência.
7. Falha de paginação ou leitura incompleta é erro visível.

## Testes Gate A
- SUP-DAT-001: rejeitar duplicidade de Idempotency_Key.
- SUP-DAT-002: impedir vínculo por descrição quando ID estiver ausente.
- SUP-DAT-003: detectar Row_Version obsoleta.
- SUP-DAT-004: paginação retorna conjunto integral ou erro explícito.
- SUP-DAT-005: projeção divergente é reconciliável a partir dos ledgers.

## Não colisão
Nenhuma alteração em `inbound.html`, `reaquecimento.html`, `os.html`, `outbox.js` ou fluxos de CRM/OS. A integração com OS será somente por contrato de IDs até a branch de OS ser liberada.