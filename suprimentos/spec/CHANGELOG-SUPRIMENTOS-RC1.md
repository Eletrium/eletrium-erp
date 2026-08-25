# Suprimentos RC1 — changelog técnico

## Escopo congelado

- contratos e schema físico versionados;
- necessidade Projeto/EAP com OS apenas contratual;
- ledger de reserva, movimento, compensação e projeção reconstruível;
- compra, recebimento, NF-e e exceções append-only;
- Graph, repositório SharePoint, ETag e lease distribuído com fencing token;
- outbox, retry seguro, reconciliação e recuperação de worker interrompido;
- gateway com JSON Schema, RBAC, rate limiter/replay guard injetáveis e redaction;
- OpenAPI, kit do consumidor OS e contrato de obrigação financeira;
- UI isolada, piloto-sombra, massa sintética, fuzzing e testes de caos;
- Gate H fechado com adapter Bom Controle exclusivamente simulado.

## Endurecimento pós-RC1

- cliente Graph com retry apenas para leituras seguras, timeout explícito e escrita de
  efeito incerto sem repetição cega;
- validação do domínio de `@odata.nextLink`, detecção de ciclo e limites máximos de
  páginas e registros;
- piloto-sombra comparativo por material, com cobertura mínima e promoção automática
  proibida em qualquer divergência;
- indicadores operacionais que bloqueiam promoção por reconciliação pendente, leitura
  incompleta, conflito não resolvido ou taxa de erro acima do limite;
- preflight de implantação que rejeita segredo em perfil, escrita externa em sombra e
  produção sem homologação/interface aprovadas;
- evidência JSON arquivada pela CI isolada por 30 dias.
- runner Microsoft Graph real em modo somente leitura, com descoberta do site/listas,
  captura de colunas e travessia integral; política e permissões não são presumidas sem
  referência externa de evidência;
- builder contratual `os.consume.v1` pronto, incluindo fingerprint e rejeição de retry
  com chave ou payload alterados.

## Compatibilidade

O RC1 não modifica CRM, máquina de estados da OS, `suprimentos.html` ou helpers
compartilhados. O contrato público é `1.0.0`; mudança incompatível exige versão major.

## Promoção

O RC1 somente pode avançar após relatório de evidências aprovado, schema SharePoint
conforme, teste de ETag/lease real, service account, rollback ensaiado e revisão do delta
da interface. PR composto não substitui a composição ordenada dos PRs de origem.
