/**
 * 延后到下一帧执行。
 *
 * 用于「点击按钮后立即卸载该界面」的场景（全屏弹窗确认后关闭、切换记录导致 key 变化重建等）：
 * 若在点击的**同一帧**内把整棵子树卸载，第三方组件（AntD 的点击波纹、浮层定位等）
 * 仍在测量已被移除的元素，会抛出
 * `Cannot read properties of null (reading 'getBoundingClientRect')`。
 *
 * 把卸载推迟一帧（约 16ms，用户无感知），让本轮点击交互先走完即可避免该竞态。
 */
export function afterPaint(fn: () => void) {
  requestAnimationFrame(() => fn())
}
