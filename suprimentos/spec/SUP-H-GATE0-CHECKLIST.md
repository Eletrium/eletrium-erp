# SUP-H — Checklist executável do Gate 0

Nenhuma chamada real é permitida enquanto `productionEnabled=false` no contrato
`bomcontrole-gate0.v1.json` ou qualquer requisito estiver ausente.

## Evidências obrigatórias

| Gate | Evidência mínima | Owner |
|---|---|---|
| Ambiente | URL e tenant de homologação validados | TI/Financeiro |
| Chave | credencial real testada fora do repositório | Service owner |
| Schemas | exemplos reais aprovados por endpoint | Integração |
| Service account | conta, responsável e rotação definidos | TI |
| Segredos | runtime provider, rotação e revogação | Segurança |
| DLP | classificação e campos proibidos em log | Segurança/LGPD |
| Retry | matriz pré-efeito × efeito incerto | Integração |
| Idempotência | chave aceita/consultável no destino | Integração |
| Rollback | procedimento ensaiado com evidência | Financeiro |
| Reconciliação | consulta por chave/ID e exceção testadas | Suprimentos |

## Estados de envio

- `CONFIRMED`: destino devolveu ID externo válido;
- `REPLAYED`: reconciliação localizou efeito anterior;
- `RETRY_QUEUED`: falha comprovadamente anterior ao efeito;
- `PENDING_RECONCILIATION`: timeout/efeito incerto; reenvio automático proibido.

O fechamento do Gate 0 exige alteração versionada e revisada de `productionEnabled`.
