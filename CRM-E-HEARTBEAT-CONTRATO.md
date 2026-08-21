# CRM-E — Contrato de heartbeat/staleness

## Regra fechada
A tela de Reaquecimento só pode declarar o espelho **FRESCO** ou **STALE** quando possuir simultaneamente:

1. um timestamp de **heartbeat dedicado do cenário/espelho**; e
2. um limiar positivo vigente configurado em política operacional.

Se faltar qualquer um dos dois, o estado é **NÃO VERIFICÁVEL**.

## Fontes proibidas como substituto de heartbeat
- `Clientes.Modified`;
- `Data_Ultima_Compra`;
- horário do carregamento da página;
- último login do usuário;
- qualquer timestamp de negócio que possa mudar por ação alheia ao cenário.

Essas fontes podem parecer recentes mesmo quando o Make estiver parado e, portanto, reproduziriam a falha silenciosa que este controle existe para detectar.

## Política
Chave proposta para `Politicas_Operacionais_Versoes`:

`CRM_REAQUECIMENTO_STALE_HORAS`

Não há valor default no código. Enquanto a política não existir, a UI mostra **Frescor não verificável — limiar ausente**.

A leitura deve usar `EG.carregarPoliticas()` + `EG.politicaVigenteEm(...)` diretamente; não adicionar default silencioso em `POLITICAS_DEFAULT` sem decisão de owner.

## Fonte de heartbeat
O campo/lista real deve ser confirmado contra o blueprint/live Make antes da integração final. Requisito semântico: o timestamp precisa mudar em **toda execução bem-sucedida do cenário**, inclusive quando nenhum cliente mudar de classificação.

Se hoje nenhum campo tiver essa semântica, criar heartbeat explícito no cenário é pré-condição para fechar o gate de staleness.

## Estados
- `FRESCO`: heartbeat válido e idade <= limiar.
- `STALE`: heartbeat válido e idade > limiar.
- `NAO_VERIFICAVEL`: heartbeat ausente/inválido, limiar ausente/inválido ou relógio inconsistente.

`CRMObservabilidade.avaliarFrescor()` é a implementação pura destes estados.

## UX mínima
- FRESCO: mensagem positiva + última atualização + idade.
- STALE: alerta destacado + última atualização + idade + limiar; dados continuam visíveis, mas não devem ser interpretados como fotografia atual sem ressalva.
- NÃO VERIFICÁVEL: alerta destacado; nunca apresentar selo verde/neutro que sugira normalidade.

## Não faz
- não expõe dados agregados em endpoint público;
- não altera `Status_Relacionamento`;
- não recalcula 90/180 dias na tela;
- não cria proposta;
- não dispara contato comercial;
- não tenta reiniciar cenário Make automaticamente.

## Gate CRM-E
1. fonte de heartbeat confirmada por blueprint/live;
2. política vigente criada e lida;
3. caso fresco provado;
4. caso stale provado;
5. cenário desativado/sem heartbeat resulta em STALE ou NÃO VERIFICÁVEL, nunca FRESCO;
6. red-team confirma que `Modified`/`Data_Ultima_Compra` não são usados como fallback.
