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

## Não colisão
Nenhuma alteração em código de CRM/OS. Persistência fica atrás de adapter próprio `suprimentos/*`; integração com telas atuais só ocorre após Gate A e revisão de conflito.