# Módulos nativos e memory card

- `Random.Generator`: geração procedural com semente independente por mapa. A mesma semente continua reproduzível; a sequência mudou em relação ao antigo xorshift em JavaScript.
- `Particles3D.Emitter`: pools por cor, emissão, movimento, gravidade, expiração e desenho por billboards nativos. Os efeitos agora são quadrados voltados à câmera.
- `Tween3D`: oscilação vertical das moedas. Os tweens são cancelados ao coletar ou devolver a moeda ao pool. A rotação completa continua usando Euler: Tween3D interpola rotações pelo arco curto e não executa uma volta de 360 graus.
- Saltos, colisões e câmera dividida continuam ligados à simulação existente para preservar a lógica dos dois jogadores.

O progresso usa o cartão do primeiro slot: `mc0:/CHICKENHOP/save.json`, com `{version: 1, top, coins}`. O saldo é compartilhado pelos dois jogadores, como já ocorria no jogo. Reinícios e comandos de depuração preservam recorde e saldo.

A leitura e a escrita de arquivos usam jobs nativos, acompanhados pelo loop. O progresso é gravado somente quando a partida termina por morte. Esse evento captura recorde e moedas daquele instante; a escrita pode concluir ou ser repetida depois, sem incluir progresso de uma nova partida. A abertura do jogo e a tela de título apenas carregam os dados. Os ícones são instalados junto da primeira gravação após uma morte. Em dois jogadores, o salvamento é disparado apenas quando ambos estão mortos e o jogo entra no estado DEAD. A primeira morte não dispara gravação. A gravação é atômica, preservando a versão anterior quando uma escrita falha. O HUD indica leitura, gravação e erros. Cartões ausentes, cheios ou sem formatação não impedem jogar; não há formatação automática. Saves inválidos ou de versão desconhecida não são sobrescritos. A troca de cartão é verificada antes de salvar uma morte; o progresso do cartão é lido antes de retomar o salvamento, somando as moedas ainda não gravadas da sessão.

Os arquivos distribuídos são `game/save/chicken.icn` e `game/save/icon.sys`. O ícone é a malha da galinha do jogo, com 204 triângulos e materiais coloridos, convertida para o formato do navegador do PS2. O descritor identifica “CHICKEN HOP / RECORD AND COINS” e usa a galinha na visualização, cópia e exclusão. O jogo gera o descritor com `MemoryCard.createIconSys`; o arquivo distribuído contém os mesmos parâmetros. Os arquivos de exemplo recebidos na raiz permanecem preservados.

Para regenerar os assets: `python3 tools/make_save_icon.py`. O layout binário segue o [IconLoader do HDLGameInstaller](https://github.com/ps2homebrew/HDLGameInstaller/blob/main/IconLoader.h). O exportador valida cabeçalho, número de vértices, sequência estática, textura e nomes dos ícones.

## Verificação em 9 de outubro de 2026

Os testes de jogador (7), mapas (11), jogo (25), salvamento (9) e contrato de partículas passaram no Node. `tests/native_random.mjs` é uma referência do algoritmo nativo somente para testes no host.

O teste determinístico executado no PCSX2 com o ELF fornecido passou em 10 verificações: Random reproduzível, limite e expiração de partículas, desenho de billboards, posição final de Tween3D, escrita de recorde 17 e moedas 23, instalação do `.icn` e `.sys`, e recarga pela integração do jogo. Evidência em `tools/evidence/native-integration.json`.

Para repetir, implante em uma pasta de teste usando `tools/deploy.py` e execute `python3 tools/check_native_pcsx2.py --stage /caminho/do/jogo`. O teste usa exclusivamente `mc0:/CHICKENHOP_TEST`; essa pasta fica no cartão após o teste. É necessário um cartão PS2 formatado no primeiro slot e PCSX2 instalado via Flatpak. O script restaura o `athena.ini` da implantação.

O ensaio adicional de 35 segundos do jogo registrou CPU p95 de 8,26–8,95 ms, máximo de 10.314 triângulos, VRAM de 3.330.304 bytes e memória estável. Houve picos isolados de aproximadamente 40 ms. As consultas `MemoryCard.getInfo` são síncronas, embora os arquivos sejam transferidos em jobs; portanto o salvamento não garante ausência absoluta de pausas.

O verificador antigo completo não passou: o ensaio registrou movimentos durante a etapa que deveria ficar parada, invalidando as expectativas de mapa inicial e morte pela águia, além de reprovar o critério de nenhum frame lento. Esses resultados estão registrados em `tools/evidence/native-game-profile.json`; não representam uma validação completa da interação por teclado. A aparência do ícone no navegador do BIOS e o comportamento em console físico ainda não foram verificados.
