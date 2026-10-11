/**
 * dsh-workbuddy-foot-card — 宿主半区。
 *
 * 这个插件只做浏览器侧的一件事：在侧栏底部（用量卡旁边）挂一张 WorkBuddy 积分卡。
 * 数据直接读 WorkBuddy 插件自己的宿主路由，因此这里不需要服务、不需要配置、
 * 不碰凭据：`apply` 是空的，声明 `inject: []` 即可让 Loader 行存在，
 * 客户端半区（lib/client.js）才会被 dsh-client-modules 扫进 web 插件名册。
 */
export const inject = []
export function apply() {}
