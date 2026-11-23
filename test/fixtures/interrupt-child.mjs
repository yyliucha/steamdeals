// EU-1 中断收尾的真进程夹具：安装 cli-interrupt 的 SIGTERM handler 后挂起等信号。
// 测试进程对其发 SIGTERM，验证「写 interrupted → 退出 143」真实发生（不经 pglite 等外部依赖）。
import { writeFileSync } from 'node:fs';
import { installSigtermHandler } from '../../src/cli-interrupt.js';

const markFile = process.env.INTERRUPT_MARK_FILE ?? '';
installSigtermHandler({
  getRun: () => JSON.parse(process.env.INTERRUPT_ACTIVE_RUN ?? 'null'),
  finish: async (run) => {
    writeFileSync(markFile, JSON.stringify({ marked: true, id: run.id, own: run.own }));
  },
});
// 挂起等信号
setInterval(() => {}, 1000);
