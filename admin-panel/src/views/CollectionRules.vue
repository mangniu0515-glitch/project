<template>
  <div class="collection-rules">
    <div class="rule-workspace-header">
      <div>
        <span>{{ currentRuleConfig.kicker }}</span>
        <h2>{{ currentRuleConfig.title }}</h2>
        <p>{{ currentRuleConfig.description }}</p>
      </div>
      <div class="rule-tabs" aria-label="采集规则类型">
        <router-link
          v-for="item in ruleTypeTabs"
          :key="item.type"
          class="rule-tab"
          :class="{ active: activeRuleType === item.type }"
          :to="item.to"
        >
          {{ item.label }}
        </router-link>
      </div>
    </div>

    <div class="section-card">
      <div class="section-header">
        <div>
          <h2>{{ currentRuleConfig.draftTitle }}</h2>
          <p>{{ currentRuleConfig.draftDescription }}</p>
        </div>
        <button class="btn btn-secondary" @click="fetchDrafts">刷新</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>截图</th>
            <th>类型</th>
            <th>来源 URL</th>
            <th>URL 模式</th>
            <th>Selector</th>
            <th>元素</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loadingDrafts">
            <td colspan="8" class="empty-cell">加载中...</td>
          </tr>
          <tr v-else-if="filteredDrafts.length === 0">
            <td colspan="8" class="empty-cell">暂无待确认草稿</td>
          </tr>
          <tr v-for="draft in filteredDrafts" :key="draft.id">
            <td>
              <img
                v-if="draft.screenshot_url"
                class="draft-shot"
                :src="draft.screenshot_url"
                alt="采集目标截图"
              >
              <span v-else class="empty-shot">无截图</span>
            </td>
            <td>
              <span class="type-pill" :class="{ hidden: isHiddenDraft(draft), email: isEmailDraft(draft) }">
                {{ getDraftTypeText(draft) }}
              </span>
              <div v-if="isHiddenDraft(draft)" class="muted-text">{{ getHideMethodText(draft.hide_method) }}</div>
              <div v-if="isEmailDraft(draft)" class="muted-text">三点采集</div>
            </td>
            <td class="mono" :title="draft.source_url">{{ truncate(draft.source_url, 42) }}</td>
            <td class="mono">{{ draft.url_pattern }}</td>
            <td class="mono">
              <template v-if="isEmailDraft(draft)">
                <div>邮箱：{{ truncate(draft.email_input_selector, 28) }}</div>
                <div>按钮：{{ truncate(draft.send_button_selector, 28) }}</div>
                <div>验证码：{{ truncate(draft.code_input_selector, 28) }}</div>
              </template>
              <template v-else>{{ draft.selector }}</template>
            </td>
            <td>
              <div>{{ draft.element_tag || '-' }} · {{ draft.element_type || 'any' }}</div>
              <div class="muted-text" :title="draft.element_text">{{ truncate(draft.element_text, 28) }}</div>
            </td>
            <td>
              <span class="status-pill" :class="{ off: draft.status !== 'pending' }">
                {{ draft.status }}
              </span>
            </td>
            <td class="actions">
              <button class="action-btn view" @click="openDraftDialog(draft)">确认</button>
              <button class="action-btn delete" @click="rejectDraft(draft)">拒绝</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section-card">
      <div class="section-header">
        <div>
          <h2>白名单站点</h2>
          <p>{{ currentRuleConfig.siteDescription }}</p>
        </div>
        <button class="btn btn-primary" @click="openSiteDialog()">新增站点</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>URL 模式</th>
            <th>状态</th>
            <th>二维码目标</th>
            <th>隐藏规则</th>
            <th>邮箱规则</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loadingSites">
            <td colspan="8" class="empty-cell">加载中...</td>
          </tr>
          <tr v-else-if="sites.length === 0">
            <td colspan="8" class="empty-cell">暂无白名单站点</td>
          </tr>
          <tr v-for="site in sites" :key="site.id" :class="{ active: selectedSite?.id === site.id }">
            <td>#{{ site.id }}</td>
            <td>{{ site.name }}</td>
            <td class="mono">{{ site.url_pattern }}</td>
            <td>
              <span class="status-pill" :class="{ off: !site.enabled }">
                {{ site.enabled ? '启用' : '停用' }}
              </span>
            </td>
            <td>{{ site.target_count || 0 }}</td>
            <td>{{ site.hidden_rule_count || 0 }}</td>
            <td>{{ site.email_rule_count || 0 }}</td>
            <td class="actions">
              <button class="action-btn view" @click="selectSite(site)">规则</button>
              <button class="action-btn view" @click="openSiteDialog(site)">编辑</button>
              <button class="action-btn delete" @click="deleteSite(site)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section-card" v-if="selectedSite && activeRuleType === 'qrcode'">
      <div class="section-header">
        <div>
          <h2>固定二维码目标</h2>
          <p>{{ selectedSite.name }} · {{ selectedSite.url_pattern }}</p>
        </div>
        <button class="btn btn-primary" @click="openTargetDialog()">新增目标</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>页面 URL 模式</th>
            <th>Selector</th>
            <th>元素</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loadingTargets">
            <td colspan="7" class="empty-cell">加载中...</td>
          </tr>
          <tr v-else-if="targets.length === 0">
            <td colspan="7" class="empty-cell">暂无目标规则</td>
          </tr>
          <tr v-for="target in targets" :key="target.id">
            <td>#{{ target.id }}</td>
            <td>{{ target.name }}</td>
            <td class="mono">{{ target.page_url_pattern }}</td>
            <td class="mono">{{ target.selector }}</td>
            <td>{{ target.element_type }}</td>
            <td>
              <span class="status-pill" :class="{ off: !target.enabled }">
                {{ target.enabled ? '启用' : '停用' }}
              </span>
            </td>
            <td class="actions">
              <button class="action-btn view" @click="openTargetDialog(target)">编辑</button>
              <button class="action-btn delete" @click="deleteTarget(target)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section-card" v-if="selectedSite && activeRuleType === 'hidden'">
      <div class="section-header">
        <div>
          <h2>隐藏元素规则</h2>
          <p>命中规则后，插件会移除或遮挡指定页面元素，管理员可在插件中临时暂停。</p>
        </div>
        <button class="btn btn-primary" @click="openHiddenRuleDialog()">新增隐藏规则</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>页面 URL 模式</th>
            <th>Selector</th>
            <th>方式</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loadingHiddenRules">
            <td colspan="7" class="empty-cell">加载中...</td>
          </tr>
          <tr v-else-if="hiddenRules.length === 0">
            <td colspan="7" class="empty-cell">暂无隐藏元素规则</td>
          </tr>
          <tr v-for="rule in hiddenRules" :key="rule.id">
            <td>#{{ rule.id }}</td>
            <td>{{ rule.name }}</td>
            <td class="mono">{{ rule.page_url_pattern }}</td>
            <td class="mono">{{ rule.selector }}</td>
            <td>{{ getHideMethodText(rule.hide_method) }}</td>
            <td>
              <span class="status-pill" :class="{ off: !rule.enabled }">
                {{ rule.enabled ? '启用' : '停用' }}
              </span>
            </td>
            <td class="actions">
              <button class="action-btn view" @click="openHiddenRuleDialog(rule)">编辑</button>
              <button class="action-btn delete" @click="deleteHiddenRule(rule)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section-card" v-if="selectedSite && activeRuleType === 'email'">
      <div class="section-header">
        <div>
          <h2>邮箱验证码规则</h2>
          <p>命中规则后，插件会监听发送验证码按钮点击，按用户绑定邮箱短时获取验证码并自动填入。</p>
        </div>
        <button class="btn btn-primary" @click="openEmailRuleDialog()">新增邮箱规则</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>页面 URL 模式</th>
            <th>邮箱输入框</th>
            <th>发送按钮</th>
            <th>验证码输入框</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loadingEmailRules">
            <td colspan="8" class="empty-cell">加载中...</td>
          </tr>
          <tr v-else-if="emailRules.length === 0">
            <td colspan="8" class="empty-cell">暂无邮箱验证码规则</td>
          </tr>
          <tr v-for="rule in emailRules" :key="rule.id">
            <td>#{{ rule.id }}</td>
            <td>{{ rule.name }}</td>
            <td class="mono">{{ rule.page_url_pattern }}</td>
            <td class="mono">{{ rule.email_input_selector }}</td>
            <td class="mono">{{ rule.send_button_selector }}</td>
            <td class="mono">{{ rule.code_input_selector }}</td>
            <td>
              <span class="status-pill" :class="{ off: !rule.enabled }">
                {{ rule.enabled ? '启用' : '停用' }}
              </span>
            </td>
            <td class="actions">
              <button class="action-btn view" @click="openEmailRuleDialog(rule)">编辑</button>
              <button class="action-btn delete" @click="deleteEmailRule(rule)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section-card" v-if="activeRuleType === 'qrcode'">
      <div class="section-header">
        <div>
          <h2>上传审计</h2>
          <p>最近的允许和拒绝记录，用于排查二维码上传规则命中情况。</p>
        </div>
        <button class="btn btn-secondary" @click="fetchAuditLogs">刷新</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>判定</th>
            <th>来源 URL</th>
            <th>站点</th>
            <th>目标</th>
            <th>原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="auditLogs.length === 0">
            <td colspan="6" class="empty-cell">暂无审计记录</td>
          </tr>
          <tr v-for="log in auditLogs" :key="log.id">
            <td>{{ formatDate(log.created_at) }}</td>
            <td>
              <span class="status-pill" :class="{ off: log.decision !== 'allowed' }">
                {{ log.decision }}
              </span>
            </td>
            <td class="mono" :title="log.source_url">{{ truncate(log.source_url, 46) }}</td>
            <td>{{ log.site_name || '-' }}</td>
            <td>{{ log.target_name || '-' }}</td>
            <td>{{ log.reason || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <el-dialog v-model="siteDialogVisible" :title="editingSite ? '编辑站点' : '新增站点'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="siteForm.name" placeholder="例如：支付页" />
        </el-form-item>
        <el-form-item label="URL 模式">
          <el-input v-model="siteForm.url_pattern" placeholder="https://example.com/pay/*" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="siteForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="siteDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveSite">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="draftDialogVisible" :title="`确认${draftDialogTypeLabel}草稿`" width="760px">
      <div v-if="editingDraft" class="draft-confirm">
        <div class="draft-preview">
          <img
            v-if="editingDraft.screenshot_url"
            :src="editingDraft.screenshot_url"
            alt="采集目标截图"
          >
          <div v-else class="empty-shot large">无截图</div>
        </div>
        <div class="draft-meta">
          <div>
            <span>来源 URL</span>
            <strong class="mono">{{ editingDraft.source_url }}</strong>
          </div>
          <div>
            <span>草稿类型</span>
            <strong>{{ getDraftTypeText(editingDraft) }}</strong>
          </div>
          <div>
            <span>元素</span>
            <strong>{{ editingDraft.element_tag || '-' }} · {{ editingDraft.element_type || 'any' }}</strong>
          </div>
          <div>
            <span>文本</span>
            <strong>{{ editingDraft.element_text || '-' }}</strong>
          </div>
        </div>
      </div>
      <el-form label-width="120px">
        <el-form-item label="规则类型">
          <el-select v-model="draftForm.draft_type">
            <el-option label="二维码目标" value="qrcode_target" />
            <el-option label="隐藏元素" value="hidden_element" />
            <el-option label="邮箱验证码场景" value="email_verification" />
          </el-select>
        </el-form-item>
        <el-form-item label="站点名称">
          <el-input v-model="draftForm.suggested_site_name" placeholder="例如：tlabel.tencent.com" />
        </el-form-item>
        <el-form-item :label="isHiddenDraftForm ? '规则名称' : '目标名称'">
          <el-input v-model="draftForm.suggested_target_name" placeholder="例如：登录二维码 / 隐藏登录提示" />
        </el-form-item>
        <el-form-item label="URL 模式">
          <el-input v-model="draftForm.url_pattern" placeholder="https://example.com/login*" />
        </el-form-item>
        <template v-if="isEmailDraftForm">
          <el-form-item label="邮箱输入框">
            <el-input v-model="draftForm.email_input_selector" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="发送按钮">
            <el-input v-model="draftForm.send_button_selector" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="验证码输入框">
            <el-input v-model="draftForm.code_input_selector" type="textarea" :rows="2" />
          </el-form-item>
        </template>
        <el-form-item v-else label="CSS Selector">
          <el-input v-model="draftForm.selector" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item v-if="isHiddenDraftForm" label="隐藏方式">
          <el-select v-model="draftForm.hide_method">
            <el-option label="不透明遮罩" value="cover" />
            <el-option label="移除元素" value="remove" />
          </el-select>
        </el-form-item>
        <el-form-item v-else-if="!isEmailDraftForm" label="元素类型">
          <el-select v-model="draftForm.element_type">
            <el-option label="任意" value="any" />
            <el-option label="图片 img" value="img" />
            <el-option label="Canvas" value="canvas" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="draftDialogVisible = false">取消</el-button>
        <el-button :loading="saving" @click="saveDraft">保存修改</el-button>
        <el-button type="primary" :loading="saving" @click="approveDraft">确认并启用</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="emailRuleDialogVisible" :title="editingEmailRule ? '编辑邮箱验证码规则' : '新增邮箱验证码规则'" width="720px">
      <el-form label-width="120px">
        <el-form-item label="名称">
          <el-input v-model="emailRuleForm.name" placeholder="例如：TLabel 邮箱验证码" />
        </el-form-item>
        <el-form-item label="页面 URL 模式">
          <el-input v-model="emailRuleForm.page_url_pattern" placeholder="https://example.com/login*" />
        </el-form-item>
        <el-form-item label="邮箱输入框">
          <el-input v-model="emailRuleForm.email_input_selector" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="发送按钮">
          <el-input v-model="emailRuleForm.send_button_selector" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="验证码输入框">
          <el-input v-model="emailRuleForm.code_input_selector" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="emailRuleForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="emailRuleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEmailRule">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="targetDialogVisible" :title="editingTarget ? '编辑目标' : '新增目标'" width="620px">
      <el-form label-width="120px">
        <el-form-item label="名称">
          <el-input v-model="targetForm.name" placeholder="例如：主二维码" />
        </el-form-item>
        <el-form-item label="页面 URL 模式">
          <el-input v-model="targetForm.page_url_pattern" placeholder="https://example.com/pay/*" />
        </el-form-item>
        <el-form-item label="CSS Selector">
          <el-input v-model="targetForm.selector" placeholder="#pay-qrcode img" />
        </el-form-item>
        <el-form-item label="元素类型">
          <el-select v-model="targetForm.element_type">
            <el-option label="任意" value="any" />
            <el-option label="图片 img" value="img" />
            <el-option label="Canvas" value="canvas" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="targetForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="targetDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveTarget">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="hiddenRuleDialogVisible" :title="editingHiddenRule ? '编辑隐藏规则' : '新增隐藏规则'" width="620px">
      <el-form label-width="120px">
        <el-form-item label="名称">
          <el-input v-model="hiddenRuleForm.name" placeholder="例如：隐藏登录提示" />
        </el-form-item>
        <el-form-item label="页面 URL 模式">
          <el-input v-model="hiddenRuleForm.page_url_pattern" placeholder="https://example.com/login*" />
        </el-form-item>
        <el-form-item label="CSS Selector">
          <el-input v-model="hiddenRuleForm.selector" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="隐藏方式">
          <el-select v-model="hiddenRuleForm.hide_method">
            <el-option label="不透明遮罩" value="cover" />
            <el-option label="移除元素" value="remove" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="hiddenRuleForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="hiddenRuleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveHiddenRule">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { collectionApi } from '@/api'
import { loadProtectedImageUrl, revokeProtectedImageUrls } from '@/utils/protectedImage'

const route = useRoute()
const sites = ref([])
const targets = ref([])
const hiddenRules = ref([])
const emailRules = ref([])
const drafts = ref([])
const auditLogs = ref([])
const selectedSite = ref(null)
const loadingSites = ref(false)
const loadingTargets = ref(false)
const loadingHiddenRules = ref(false)
const loadingEmailRules = ref(false)
const loadingDrafts = ref(false)
const saving = ref(false)
const siteDialogVisible = ref(false)
const targetDialogVisible = ref(false)
const hiddenRuleDialogVisible = ref(false)
const emailRuleDialogVisible = ref(false)
const draftDialogVisible = ref(false)
const editingSite = ref(null)
const editingTarget = ref(null)
const editingHiddenRule = ref(null)
const editingEmailRule = ref(null)
const editingDraft = ref(null)
let activeDraftScreenshotUrls = []

const siteForm = reactive({
  name: '',
  url_pattern: '',
  enabled: true
})

const targetForm = reactive({
  name: '',
  page_url_pattern: '',
  selector: '',
  element_type: 'any',
  enabled: true
})

const hiddenRuleForm = reactive({
  name: '',
  page_url_pattern: '',
  selector: '',
  hide_method: 'cover',
  enabled: true
})

const emailRuleForm = reactive({
  name: '',
  page_url_pattern: '',
  email_input_selector: '',
  send_button_selector: '',
  code_input_selector: '',
  enabled: true
})

const draftForm = reactive({
  draft_type: 'qrcode_target',
  suggested_site_name: '',
  suggested_target_name: '',
  url_pattern: '',
  selector: '',
  email_input_selector: '',
  send_button_selector: '',
  code_input_selector: '',
  element_type: 'any',
  hide_method: 'cover'
})

const ruleTypeTabs = [
  { type: 'qrcode', label: '二维码规则', to: '/collection-rules/qrcode' },
  { type: 'email', label: '验证码规则', to: '/collection-rules/email' },
  { type: 'hidden', label: '隐藏元素', to: '/collection-rules/hidden' }
]

const ruleTypeConfig = {
  qrcode: {
    kicker: 'QR CODE TARGETS',
    title: '二维码规则',
    description: '管理页面中的授权二维码目标，普通用户或组长命中后按身份策略自动上传。',
    draftTitle: '二维码草稿',
    draftDescription: '插件采集到二维码目标后，先在这里确认再启用。',
    siteDescription: '站点命中 URL 模式后，插件才会应用该站点下的二维码目标。'
  },
  email: {
    kicker: 'EMAIL VERIFICATION',
    title: '验证码规则',
    description: '管理邮箱验证码三点场景：邮箱输入框、发送按钮、验证码输入框。',
    draftTitle: '验证码场景草稿',
    draftDescription: '管理员在插件中完成三点采集后，先在这里确认再启用。',
    siteDescription: '站点命中 URL 模式后，插件才会监听发送按钮并短时获取验证码。'
  },
  hidden: {
    kicker: 'HIDDEN ELEMENTS',
    title: '隐藏元素规则',
    description: '管理需要从客户端页面移除或遮挡的元素，避免普通用户看到敏感区域。',
    draftTitle: '隐藏元素草稿',
    draftDescription: '插件采集到隐藏目标后，先在这里确认隐藏方式再启用。',
    siteDescription: '站点命中 URL 模式后，插件才会应用隐藏元素规则。'
  }
}

const activeRuleType = computed(() => {
  const value = route.params.ruleType
  return ['qrcode', 'email', 'hidden'].includes(value) ? value : 'qrcode'
})

const currentRuleConfig = computed(() => ruleTypeConfig[activeRuleType.value])

const isHiddenDraft = (draft) => draft?.draft_type === 'hidden_element'
const isEmailDraft = (draft) => draft?.draft_type === 'email_verification'
const draftMatchesActiveType = (draft) => {
  if (activeRuleType.value === 'email') return isEmailDraft(draft)
  if (activeRuleType.value === 'hidden') return isHiddenDraft(draft)
  return !isEmailDraft(draft) && !isHiddenDraft(draft)
}
const filteredDrafts = computed(() => drafts.value.filter(draftMatchesActiveType))
const isHiddenDraftForm = computed(() => draftForm.draft_type === 'hidden_element')
const isEmailDraftForm = computed(() => draftForm.draft_type === 'email_verification')
const draftDialogTypeLabel = computed(() => isEmailDraftForm.value ? '邮箱验证码场景' : isHiddenDraftForm.value ? '隐藏元素' : '二维码目标')
const getDraftTypeText = (draft) => isEmailDraft(draft) ? '邮箱验证码场景' : isHiddenDraft(draft) ? '隐藏元素' : '二维码目标'
const getHideMethodText = (method) => method === 'remove' ? '移除元素' : '不透明遮罩'

const fetchSites = async () => {
  loadingSites.value = true
  try {
    const response = await collectionApi.getSites()
    sites.value = response.sites || []
    if (selectedSite.value) {
      selectedSite.value = sites.value.find(site => site.id === selectedSite.value.id) || null
    }
  } finally {
    loadingSites.value = false
  }
}

const selectSite = async (site) => {
  selectedSite.value = site
  await Promise.all([fetchTargets(), fetchHiddenRules(), fetchEmailRules()])
}

const fetchTargets = async () => {
  if (!selectedSite.value) return
  loadingTargets.value = true
  try {
    const response = await collectionApi.getTargets(selectedSite.value.id)
    targets.value = response.targets || []
  } finally {
    loadingTargets.value = false
  }
}

const fetchHiddenRules = async () => {
  if (!selectedSite.value) return
  loadingHiddenRules.value = true
  try {
    const response = await collectionApi.getHiddenRules(selectedSite.value.id)
    hiddenRules.value = response.rules || []
  } finally {
    loadingHiddenRules.value = false
  }
}

const fetchEmailRules = async () => {
  if (!selectedSite.value) return
  loadingEmailRules.value = true
  try {
    const response = await collectionApi.getEmailVerificationRules(selectedSite.value.id)
    emailRules.value = response.rules || []
  } finally {
    loadingEmailRules.value = false
  }
}

const fetchAuditLogs = async () => {
  const response = await collectionApi.getAuditLogs({ limit: 100 })
  auditLogs.value = response.logs || []
}

const fetchDrafts = async () => {
  loadingDrafts.value = true
  try {
    const response = await collectionApi.getDrafts({ status: 'pending' })
    revokeProtectedImageUrls(activeDraftScreenshotUrls)
    activeDraftScreenshotUrls = []
    drafts.value = await Promise.all((response.drafts || []).map(async draft => {
      if (!draft.screenshot_path) return { ...draft, screenshot_url: null }
      try {
        const screenshotUrl = await loadProtectedImageUrl(draft.screenshot_path)
        if (screenshotUrl) activeDraftScreenshotUrls.push(screenshotUrl)
        return { ...draft, screenshot_url: screenshotUrl }
      } catch (error) {
        console.error('Failed to load draft screenshot:', error)
        return { ...draft, screenshot_url: null }
      }
    }))
  } finally {
    loadingDrafts.value = false
  }
}

const openSiteDialog = (site = null) => {
  editingSite.value = site
  siteForm.name = site?.name || ''
  siteForm.url_pattern = site?.url_pattern || ''
  siteForm.enabled = site ? !!site.enabled : true
  siteDialogVisible.value = true
}

const saveSite = async () => {
  if (!siteForm.name || !siteForm.url_pattern) {
    ElMessage.warning('请填写站点名称和 URL 模式')
    return
  }

  saving.value = true
  try {
    const payload = { ...siteForm }
    if (editingSite.value) {
      await collectionApi.updateSite(editingSite.value.id, payload)
    } else {
      await collectionApi.createSite(payload)
    }
    siteDialogVisible.value = false
    ElMessage.success('保存成功')
    await fetchSites()
  } finally {
    saving.value = false
  }
}

const deleteSite = async (site) => {
  await ElMessageBox.confirm(`确定删除站点「${site.name}」及其二维码目标、隐藏规则和邮箱验证码规则吗？`, '提示', { type: 'warning' })
  await collectionApi.deleteSite(site.id)
  if (selectedSite.value?.id === site.id) {
    selectedSite.value = null
    targets.value = []
    hiddenRules.value = []
    emailRules.value = []
  }
  ElMessage.success('删除成功')
  await fetchSites()
}

const openTargetDialog = (target = null) => {
  editingTarget.value = target
  targetForm.name = target?.name || ''
  targetForm.page_url_pattern = target?.page_url_pattern || selectedSite.value?.url_pattern || ''
  targetForm.selector = target?.selector || ''
  targetForm.element_type = target?.element_type || 'any'
  targetForm.enabled = target ? !!target.enabled : true
  targetDialogVisible.value = true
}

const saveTarget = async () => {
  if (!selectedSite.value) return
  if (!targetForm.name || !targetForm.page_url_pattern || !targetForm.selector) {
    ElMessage.warning('请填写目标名称、页面 URL 模式和 selector')
    return
  }

  saving.value = true
  try {
    const payload = { ...targetForm }
    if (editingTarget.value) {
      await collectionApi.updateTarget(editingTarget.value.id, payload)
    } else {
      await collectionApi.createTarget(selectedSite.value.id, payload)
    }
    targetDialogVisible.value = false
    ElMessage.success('保存成功')
    await fetchTargets()
    await fetchSites()
  } finally {
    saving.value = false
  }
}

const deleteTarget = async (target) => {
  await ElMessageBox.confirm(`确定删除目标「${target.name}」吗？`, '提示', { type: 'warning' })
  await collectionApi.deleteTarget(target.id)
  ElMessage.success('删除成功')
  await fetchTargets()
  await fetchSites()
}

const openHiddenRuleDialog = (rule = null) => {
  editingHiddenRule.value = rule
  hiddenRuleForm.name = rule?.name || ''
  hiddenRuleForm.page_url_pattern = rule?.page_url_pattern || selectedSite.value?.url_pattern || ''
  hiddenRuleForm.selector = rule?.selector || ''
  hiddenRuleForm.hide_method = rule?.hide_method || 'cover'
  hiddenRuleForm.enabled = rule ? !!rule.enabled : true
  hiddenRuleDialogVisible.value = true
}

const saveHiddenRule = async () => {
  if (!selectedSite.value) return
  if (!hiddenRuleForm.name || !hiddenRuleForm.page_url_pattern || !hiddenRuleForm.selector) {
    ElMessage.warning('请填写规则名称、页面 URL 模式和 selector')
    return
  }

  saving.value = true
  try {
    const payload = { ...hiddenRuleForm }
    if (editingHiddenRule.value) {
      await collectionApi.updateHiddenRule(editingHiddenRule.value.id, payload)
    } else {
      await collectionApi.createHiddenRule(selectedSite.value.id, payload)
    }
    hiddenRuleDialogVisible.value = false
    ElMessage.success('保存成功')
    await fetchHiddenRules()
    await fetchSites()
  } finally {
    saving.value = false
  }
}

const deleteHiddenRule = async (rule) => {
  await ElMessageBox.confirm(`确定删除隐藏规则「${rule.name}」吗？`, '提示', { type: 'warning' })
  await collectionApi.deleteHiddenRule(rule.id)
  ElMessage.success('删除成功')
  await fetchHiddenRules()
  await fetchSites()
}

const openEmailRuleDialog = (rule = null) => {
  editingEmailRule.value = rule
  emailRuleForm.name = rule?.name || ''
  emailRuleForm.page_url_pattern = rule?.page_url_pattern || selectedSite.value?.url_pattern || ''
  emailRuleForm.email_input_selector = rule?.email_input_selector || ''
  emailRuleForm.send_button_selector = rule?.send_button_selector || ''
  emailRuleForm.code_input_selector = rule?.code_input_selector || ''
  emailRuleForm.enabled = rule ? !!rule.enabled : true
  emailRuleDialogVisible.value = true
}

const saveEmailRule = async () => {
  if (!selectedSite.value) return
  if (
    !emailRuleForm.name ||
    !emailRuleForm.page_url_pattern ||
    !emailRuleForm.email_input_selector ||
    !emailRuleForm.send_button_selector ||
    !emailRuleForm.code_input_selector
  ) {
    ElMessage.warning('请填写名称、页面 URL 模式和三个 selector')
    return
  }

  saving.value = true
  try {
    const payload = { ...emailRuleForm }
    if (editingEmailRule.value) {
      await collectionApi.updateEmailVerificationRule(editingEmailRule.value.id, payload)
    } else {
      await collectionApi.createEmailVerificationRule(selectedSite.value.id, payload)
    }
    emailRuleDialogVisible.value = false
    ElMessage.success('保存成功')
    await fetchEmailRules()
    await fetchSites()
  } finally {
    saving.value = false
  }
}

const deleteEmailRule = async (rule) => {
  await ElMessageBox.confirm(`确定删除邮箱验证码规则「${rule.name}」吗？`, '提示', { type: 'warning' })
  await collectionApi.deleteEmailVerificationRule(rule.id)
  ElMessage.success('删除成功')
  await fetchEmailRules()
  await fetchSites()
}

const openDraftDialog = (draft) => {
  editingDraft.value = draft
  draftForm.draft_type = draft?.draft_type === 'email_verification'
    ? 'email_verification'
    : draft?.draft_type === 'hidden_element'
      ? 'hidden_element'
      : 'qrcode_target'
  draftForm.suggested_site_name = draft?.suggested_site_name || ''
  draftForm.suggested_target_name = draft?.suggested_target_name || ''
  draftForm.url_pattern = draft?.url_pattern || ''
  draftForm.selector = draft?.selector || ''
  draftForm.email_input_selector = draft?.email_input_selector || draft?.email_selectors?.email_input_selector || ''
  draftForm.send_button_selector = draft?.send_button_selector || draft?.email_selectors?.send_button_selector || ''
  draftForm.code_input_selector = draft?.code_input_selector || draft?.email_selectors?.code_input_selector || ''
  draftForm.element_type = draft?.element_type || 'any'
  draftForm.hide_method = draft?.hide_method || 'cover'
  draftDialogVisible.value = true
}

const getDraftPayload = () => {
  const payload = {
    draft_type: draftForm.draft_type,
    suggested_site_name: draftForm.suggested_site_name,
    suggested_target_name: draftForm.suggested_target_name,
    url_pattern: draftForm.url_pattern
  }

  if (draftForm.draft_type === 'email_verification') {
    payload.selector = draftForm.email_input_selector
    payload.email_input_selector = draftForm.email_input_selector
    payload.send_button_selector = draftForm.send_button_selector
    payload.code_input_selector = draftForm.code_input_selector
    payload.element_type = 'any'
  } else {
    payload.selector = draftForm.selector
    payload.element_type = draftForm.element_type
  }

  if (draftForm.draft_type === 'hidden_element') {
    payload.hide_method = draftForm.hide_method
  }

  return payload
}

const validateDraftForm = () => {
  if (!draftForm.suggested_site_name || !draftForm.suggested_target_name || !draftForm.url_pattern) {
    ElMessage.warning('请填写站点名称、规则/目标名称、URL 模式和 selector')
    return false
  }
  if (isEmailDraftForm.value) {
    if (!draftForm.email_input_selector || !draftForm.send_button_selector || !draftForm.code_input_selector) {
      ElMessage.warning('请填写邮箱输入框、发送按钮和验证码输入框 selector')
      return false
    }
  } else if (!draftForm.selector) {
    ElMessage.warning('请填写 selector')
    return false
  }
  return true
}

const saveDraft = async () => {
  if (!editingDraft.value || !validateDraftForm()) return

  saving.value = true
  try {
    const response = await collectionApi.updateDraft(editingDraft.value.id, getDraftPayload())
    ElMessage.success('草稿已保存')
    await fetchDrafts()
    editingDraft.value = drafts.value.find(draft => draft.id === response.draft?.id) || response.draft || editingDraft.value
  } finally {
    saving.value = false
  }
}

const approveDraft = async () => {
  if (!editingDraft.value || !validateDraftForm()) return

  saving.value = true
  try {
    const response = await collectionApi.approveDraft(editingDraft.value.id, getDraftPayload())
    draftDialogVisible.value = false
    ElMessage.success('草稿已确认，规则已启用')
    await fetchDrafts()
    await fetchSites()
    if (response.site) {
      const site = sites.value.find(item => item.id === response.site.id) || response.site
      await selectSite(site)
    } else if (selectedSite.value) {
      await Promise.all([fetchTargets(), fetchHiddenRules(), fetchEmailRules()])
    }
  } finally {
    saving.value = false
  }
}

const rejectDraft = async (draft) => {
  await ElMessageBox.confirm(`确定拒绝草稿 #${draft.id} 吗？`, '提示', { type: 'warning' })
  await collectionApi.rejectDraft(draft.id)
  ElMessage.success('草稿已拒绝')
  await fetchDrafts()
}

const formatDate = (date) => date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'
const truncate = (text, length) => {
  if (!text) return '-'
  return text.length > length ? `${text.slice(0, length)}...` : text
}

onMounted(async () => {
  await fetchDrafts()
  await fetchSites()
  if (sites.value[0]) await selectSite(sites.value[0])
  await fetchAuditLogs()
})

onUnmounted(() => {
  revokeProtectedImageUrls(activeDraftScreenshotUrls)
  activeDraftScreenshotUrls = []
})
</script>

<style scoped>
.collection-rules {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.rule-workspace-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px;
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  background:
    radial-gradient(circle at 6% 12%, rgba(0, 122, 255, 0.08), transparent 34%),
    #fff;
  box-shadow: var(--admin-shadow-md);
}

.rule-workspace-header span {
  color: var(--admin-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.rule-workspace-header h2 {
  margin: 6px 0 5px;
  color: var(--admin-text);
  font-size: 22px;
  letter-spacing: -0.03em;
}

.rule-workspace-header p {
  max-width: 680px;
  margin: 0;
  color: var(--admin-muted);
  line-height: 1.6;
}

.rule-tabs {
  display: inline-flex;
  gap: 5px;
  padding: 5px;
  border: 1px solid var(--admin-border-soft);
  border-radius: 999px;
  background: #f8fafc;
}

.rule-tab {
  padding: 7px 12px;
  border-radius: 999px;
  color: var(--admin-muted);
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
  transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease;
}

.rule-tab:hover {
  color: var(--admin-text);
}

.rule-tab.active {
  background: #fff;
  color: var(--admin-primary);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
}

.section-card {
  background: var(--admin-surface);
  border: 1px solid var(--admin-border-soft);
  border-radius: var(--admin-radius-xl);
  padding: 20px;
  box-shadow: var(--admin-shadow-md);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.section-header h2 {
  font-size: 18px;
  color: var(--admin-text);
  margin: 0 0 6px;
}

.section-header p {
  color: var(--admin-muted);
  margin: 0;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--admin-border-soft);
  text-align: left;
  font-size: 13px;
  vertical-align: top;
}

.data-table th {
  background: #f8fafc;
  color: var(--admin-muted);
  font-weight: 700;
}

.data-table tr.active {
  background: rgba(0, 122, 255, 0.06);
  box-shadow: inset 3px 0 0 var(--admin-primary);
}

.empty-cell {
  text-align: center;
  color: var(--admin-muted);
  padding: 32px;
}

.muted-text {
  color: var(--admin-muted);
  font-size: 12px;
  margin-top: 4px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  word-break: break-all;
}

.status-pill,
.type-pill {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--admin-success-soft);
  color: #1f8f3a;
  font-size: 12px;
}

.status-pill.off {
  background: var(--admin-danger-soft);
  color: var(--admin-danger);
}

.type-pill {
  background: rgba(0, 122, 255, 0.1);
  color: var(--admin-primary);
}

.type-pill.hidden {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}

.type-pill.email {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}

.actions {
  white-space: nowrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 8px 15px;
  border: 1px solid transparent;
  border-radius: var(--admin-radius-sm);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: background var(--admin-transition), border-color var(--admin-transition), box-shadow var(--admin-transition);
}

.btn-primary {
  background: var(--admin-primary);
  color: #fff;
}

.btn-secondary {
  background: #fff;
  border-color: var(--admin-border-soft);
  color: var(--admin-text-soft);
}

.btn-primary:hover {
  background: var(--admin-primary-dark);
  box-shadow: 0 10px 20px rgba(0, 122, 255, 0.16);
}

.btn-secondary:hover {
  background: var(--admin-bg-soft);
  border-color: rgba(0, 122, 255, 0.2);
}

.action-btn {
  padding: 5px 9px;
  border: none;
  border-radius: var(--admin-radius-sm);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  margin-right: 4px;
}

.action-btn.view {
  background: rgba(0, 122, 255, 0.1);
  color: var(--admin-primary);
}

.action-btn.delete {
  background: var(--admin-danger-soft);
  color: var(--admin-danger);
}

.draft-shot {
  width: 92px;
  height: 64px;
  object-fit: contain;
  border-radius: var(--admin-radius-sm);
  background: #f8fafc;
  border: 1px solid var(--admin-border-soft);
}

.empty-shot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 92px;
  height: 64px;
  border-radius: var(--admin-radius-sm);
  background: #f8fafc;
  color: var(--admin-muted);
  font-size: 12px;
}

.empty-shot.large {
  width: 100%;
  min-height: 160px;
}

.draft-confirm {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  margin-bottom: 18px;
}

.draft-preview {
  min-height: 160px;
  border-radius: 12px;
  background: #f5f5f7;
  border: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.draft-preview img {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
}

.draft-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.draft-meta span {
  display: block;
  color: #86868b;
  font-size: 12px;
  margin-bottom: 4px;
}

.draft-meta strong {
  display: block;
  color: #1d1d1f;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-all;
}

@media (max-width: 760px) {
  .rule-workspace-header {
    align-items: stretch;
    flex-direction: column;
  }

  .rule-tabs {
    overflow-x: auto;
  }

  .draft-confirm {
    grid-template-columns: 1fr;
  }
}
</style>
