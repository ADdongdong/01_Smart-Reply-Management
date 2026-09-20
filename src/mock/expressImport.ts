import type { ExpressImportResult, ExpressMatchRow } from '@/types'

/**
 * 快递数据导入的匹配结果（演示数据）
 *
 * 匹配逻辑：Excel 中的「运单号」与回函面单识别出的快递单号逐一比对，
 * 命中则把快递详细信息（快递公司 / 发件人 / 电话 / 地址）写入对应函证。
 */
const ROWS: ExpressMatchRow[] = [
  {
    id: 'e1',
    expressNo: 'SF7444706557147',
    expressCompany: '顺丰速运',
    sender: '陈静',
    phone: '13800000005',
    address: '广东省广州市黄埔区腾飞一街2号618室',
    matchedConfirmationNo: 'whzf0010006',
    matchedEntity: '广东证券股份有限公司',
    matchedSendRecordNo: '20260810000006',
    status: 'matched',
  },
  {
    id: 'e2',
    expressNo: 'SF7444706556947',
    expressCompany: '顺丰速运',
    sender: '李明',
    phone: '13900000006',
    address: '广东省深圳市南山区科技园南区8栋',
    matchedConfirmationNo: 'whzf0010005',
    matchedEntity: '海通证券股份有限公司',
    matchedSendRecordNo: '20260810000005',
    status: 'matched',
  },
  {
    id: 'e3',
    expressNo: 'SF528601590893',
    expressCompany: '顺丰速运',
    sender: '王芳',
    phone: '13700000007',
    address: '北京市西城区金融大街35号国际企业大厦',
    matchedConfirmationNo: 'whzf0010003',
    matchedEntity: '华泰证券股份有限公司',
    matchedSendRecordNo: '20260810000003',
    status: 'matched',
  },
  {
    id: 'e4',
    expressNo: 'SF528601590877',
    expressCompany: '顺丰速运',
    sender: '张伟',
    phone: '13600000008',
    address: '上海市浦东新区世纪大道1500号',
    matchedConfirmationNo: 'whzf0010002',
    matchedEntity: '中信证券股份有限公司',
    matchedSendRecordNo: '20260810000002',
    status: 'matched',
  },
  {
    id: 'e5',
    expressNo: 'SF528601590861',
    expressCompany: '顺丰速运',
    sender: '刘洋',
    phone: '13500000009',
    address: '广东省广州市天河区珠江新城华夏路10号',
    matchedConfirmationNo: 'whzf0010001',
    matchedEntity: '广发证券股份有限公司',
    matchedSendRecordNo: '20260810000001',
    status: 'matched',
  },
  {
    id: 'e6',
    expressNo: 'SF9999888877776',
    expressCompany: '顺丰速运',
    sender: '孙倩',
    phone: '13300000011',
    address: '浙江省杭州市西湖区文三路90号',
    status: 'unmatched',
    reason: '该快递单号未在任何回函面单中被识别到，无法归属到具体函证',
  },
]

export const EXPRESS_IMPORT_RESULT: ExpressImportResult = {
  fileName: '快递数据导入模板_20260914.xlsx',
  fileSize: '18 KB',
  totalRows: ROWS.length,
  matchedCount: ROWS.filter((r) => r.status === 'matched').length,
  unmatchedCount: ROWS.filter((r) => r.status === 'unmatched').length,
  rows: ROWS,
  importedAt: '2026-09-14 17:20:36',
}
