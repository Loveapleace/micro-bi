import React, { useState, useEffect, useRef } from 'react';
import { Modal, Form, Radio, Select, Checkbox, Space, Typography, Card, Divider, Tag } from 'antd';
import { TableOutlined, AppstoreOutlined, ThunderboltOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { CellDefinition, CellTemplateDocumentV1, DynamicMergePolicy } from '../report-template/types.js';
import { generateTemplateCellId, resolveFieldId, resolveMetricId } from '../report-template/identity.js';
import type { FieldItem } from './CellInspector.js';

const { Text, Paragraph } = Typography;

export interface ReportWizardModalProps {
  open: boolean;
  fields: FieldItem[];
  datasetId?: string | undefined;
  datasetName?: string | undefined;
  onGenerate: (newDoc: CellTemplateDocumentV1) => void;
  onCancel: () => void;
}

export const ReportWizardModal: React.FC<ReportWizardModalProps> = ({
  open,
  fields,
  datasetId = 'dataset_1',
  datasetName = '当前数据集',
  onGenerate,
  onCancel,
}) => {
  const [templateType, setTemplateType] = useState<'pivot' | 'grouped' | 'detail'>('pivot');

  // 维度与度量候选
  const numericFields = fields.filter((f) => f.type === 'number');
  const dateFields = fields.filter((f) => f.type === 'date');
  const stringFields = fields.filter((f) => f.type !== 'number');

  // 双向交叉表配置状态
  const [pivotRowDim, setPivotRowDim] = useState<string>(stringFields[0]?.key || fields[0]?.key || '');
  const [pivotColDim, setPivotColDim] = useState<string>(dateFields[0]?.key || stringFields[1]?.key || '');
  const [pivotTimeBucket, setPivotTimeBucket] = useState<'day' | 'month' | 'none'>('month');
  const [pivotMeasures, setPivotMeasures] = useState<string[]>(
    numericFields.slice(0, 2).map((f) => f.key)
  );

  // 层级分组报表配置状态
  const [groupPrimaryDim, setGroupPrimaryDim] = useState<string>(stringFields[0]?.key || fields[0]?.key || '');
  const [groupSecondaryDim, setGroupSecondaryDim] = useState<string>(stringFields[1]?.key || '');
  const [groupMeasures, setGroupMeasures] = useState<string[]>(
    numericFields.slice(0, 2).map((f) => f.key)
  );

  // 明细清单报表配置状态
  const [detailFields, setDetailFields] = useState<string[]>(() =>
    fields.slice(0, 5).map((f) => f.key)
  );

  // 记录上一次应用的数据集 ID，用于跨数据源切换时自动重置向导选项
  const prevDatasetIdRef = useRef<string | undefined>(datasetId);

  // 监听 datasetId / fields / open 变化，确保下拉选项值与维护状态跟进所选数据源
  useEffect(() => {
    if (!fields || fields.length === 0) return;

    const datasetChanged = prevDatasetIdRef.current !== datasetId;
    if (datasetChanged) {
      prevDatasetIdRef.current = datasetId;
    }

    const numeric = fields.filter((f) => f.type === 'number');
    const date = fields.filter((f) => f.type === 'date');
    const stringFlds = fields.filter((f) => f.type !== 'number');
    const fieldKeySet = new Set(fields.map((f) => f.key));

    // 1. 双向交叉表状态同步
    const isPivotRowValid = Boolean(pivotRowDim && fieldKeySet.has(pivotRowDim));
    const isPivotColValid = Boolean(pivotColDim && fieldKeySet.has(pivotColDim));
    const validPivotMeasures = pivotMeasures.filter((k) => fieldKeySet.has(k));

    let nextPivotRow = pivotRowDim;
    if (datasetChanged || !isPivotRowValid) {
      nextPivotRow = stringFlds[0]?.key || fields[0]?.key || '';
      setPivotRowDim(nextPivotRow);
    }

    if (datasetChanged || !isPivotColValid) {
      const candidateCol =
        date.find((f) => f.key !== nextPivotRow)?.key ||
        stringFlds.find((f) => f.key !== nextPivotRow)?.key ||
        fields.find((f) => f.key !== nextPivotRow)?.key ||
        fields[1]?.key ||
        fields[0]?.key ||
        '';
      setPivotColDim(candidateCol);
    }

    if (datasetChanged || validPivotMeasures.length === 0) {
      const defaultMeasures =
        numeric.length > 0
          ? numeric.slice(0, 2).map((f) => f.key)
          : fields.slice(0, 2).map((f) => f.key);
      setPivotMeasures(defaultMeasures);
    } else if (validPivotMeasures.length !== pivotMeasures.length) {
      setPivotMeasures(validPivotMeasures);
    }

    // 2. 层级分组报表状态同步
    const isGroupPrimaryValid = Boolean(groupPrimaryDim && fieldKeySet.has(groupPrimaryDim));
    const isGroupSecondaryValid = groupSecondaryDim ? fieldKeySet.has(groupSecondaryDim) : true;
    const validGroupMeasures = groupMeasures.filter((k) => fieldKeySet.has(k));

    let nextGroupPrimary = groupPrimaryDim;
    if (datasetChanged || !isGroupPrimaryValid) {
      nextGroupPrimary = stringFlds[0]?.key || fields[0]?.key || '';
      setGroupPrimaryDim(nextGroupPrimary);
    }

    if (datasetChanged || (!isGroupSecondaryValid && groupSecondaryDim)) {
      const candidateSec =
        stringFlds.find((f) => f.key !== nextGroupPrimary)?.key ||
        fields.find((f) => f.key !== nextGroupPrimary)?.key ||
        '';
      setGroupSecondaryDim(candidateSec);
    }

    if (datasetChanged || validGroupMeasures.length === 0) {
      const defaultGroupMeasures =
        numeric.length > 0
          ? numeric.slice(0, 2).map((f) => f.key)
          : fields.slice(0, 2).map((f) => f.key);
      setGroupMeasures(defaultGroupMeasures);
    } else if (validGroupMeasures.length !== groupMeasures.length) {
      setGroupMeasures(validGroupMeasures);
    }

    // 3. 清单明细报表状态同步
    const validDetailFields = detailFields.filter((k) => fieldKeySet.has(k));
    if (datasetChanged || validDetailFields.length === 0) {
      setDetailFields(fields.slice(0, Math.min(fields.length, 5)).map((f) => f.key));
    } else if (validDetailFields.length !== detailFields.length) {
      setDetailFields(validDetailFields);
    }
  }, [datasetId, open, fields]);

  const handleConfirm = () => {
    const sheetId = 'sheet-1';
    const regionId = 'region-1';

    if (templateType === 'pivot') {
      // 生成标准双向交叉报表 (FineReport 核心范式)
      const rowDimField = fields.find((f) => f.key === pivotRowDim) || fields[0];
      const colDimField =
        fields.find((f) => f.key === pivotColDim) ||
        fields.find((f) => f.key !== rowDimField?.key) ||
        fields[1] ||
        fields[0];
      const isDate = colDimField?.type === 'date';

      const rowDimCellId = `cell-row-dim-${rowDimField?.key || 'row'}`;
      const colDimCellId = `cell-col-dim-${colDimField?.key || 'col'}`;

      const cells: CellDefinition[] = [
        // 标题与说明
        {
          id: 'title',
          sheetId,
          position: { row: 0, column: 0 },
          content: { kind: 'literal', value: `${rowDimField?.label || '维度'} × ${colDimField?.label || '时间'} 双向交叉报表` },
          parents: { row: null, column: null },
          style: { bold: true, fontSize: 14, color: '#1677ff' },
        },
        // 表头行 (Row 2): [行维度名称] [指标] [列维度(向右扩展)]
        {
          id: 'hdr-row-name',
          sheetId,
          position: { row: 2, column: 0 },
          content: { kind: 'literal', value: rowDimField?.label || '行维度' },
          parents: { row: null, column: null },
          style: { bold: true, backgroundColor: '#fafafa' },
        },
        {
          id: 'hdr-metric-name',
          sheetId,
          position: { row: 2, column: 1 },
          content: { kind: 'literal', value: '指标名称' },
          parents: { row: null, column: null },
          style: { bold: true, backgroundColor: '#fafafa' },
        },
        {
          id: colDimCellId,
          sheetId,
          regionId,
          position: { row: 2, column: 2 },
          content: {
            kind: 'field',
            fieldId: resolveFieldId(colDimField?.key || 'col_dim'),
            fieldKey: colDimField?.key || 'col_dim',
            role: 'column-dimension',
            operation: 'group',
            expand: 'right',
            timeBucket: isDate && pivotTimeBucket !== 'none' ? { granularity: pivotTimeBucket } : undefined,
            displayName: colDimField?.label || '列维度',
          },
          parents: { row: null, column: null },
          style: { bold: true, color: '#531dab', backgroundColor: '#f9f0ff', textAlign: 'center', verticalAlign: 'middle' },
        },
        // 行维度数据格 (Row 3, Col 0): 向下扩展
        {
          id: rowDimCellId,
          sheetId,
          regionId,
          position: { row: 3, column: 0 },
          content: {
            kind: 'field',
            fieldId: resolveFieldId(rowDimField?.key || 'row_dim'),
            fieldKey: rowDimField?.key || 'row_dim',
            role: 'row-dimension',
            operation: 'group',
            expand: 'down',
            displayName: rowDimField?.label || '行维度',
          },
          parents: { row: null, column: null },
          style: { bold: true, color: '#0958d9', backgroundColor: '#e6f7ff', verticalAlign: 'top' },
        },
      ];

      // 生成每个指标度量的标签行与交叉计算格
      pivotMeasures.forEach((mKey, idx) => {
        const mField = fields.find((f) => f.key === mKey);
        const mRow = 3 + idx;
        const isNum = mField?.type === 'number';

        // 指标标签 (Col 1): 绑定行父格，随左侧行维度展开按车间/明细重复渲染
        cells.push({
          id: `lbl-metric-${mKey}`,
          sheetId,
          regionId,
          position: { row: mRow, column: 1 },
          content: { kind: 'literal', value: mField?.label || mKey },
          parents: { row: 'default', column: null },
          style: { color: '#595959', backgroundColor: '#fafafa', verticalAlign: 'middle' },
        });

        // 核心交叉度量格 (Col 2): 绑定双父格（默认跟随左侧最近行维度与上方最近列维度）
        cells.push({
          id: `meas-${mKey}`,
          sheetId,
          regionId,
          position: { row: mRow, column: 2 },
          content: {
            kind: 'field',
            fieldId: resolveFieldId(mKey),
            fieldKey: mKey,
            metricId: resolveMetricId(mKey, isNum ? 'sum' : 'count'),
            role: 'measure',
            operation: isNum ? 'sum' : 'count',
            expand: 'inherit',
            displayName: mField?.label || mKey,
            format: isNum ? 'number' : undefined,
          },
          parents: {
            row: 'default',
            column: 'default',
          },
          style: { textAlign: 'right', color: '#d46b08', backgroundColor: '#fff7e6' },
        });
      });

      const newDoc: CellTemplateDocumentV1 = {
        documentType: 'cell-template',
        schemaVersion: '2.0',
        capabilitiesVersion: 'cell-expansion-v2',
        id: `template-${Date.now()}`,
        title: `${rowDimField?.label || '维度'} × ${colDimField?.label || '时间'} 双向交叉表`,
        templateRevision: 1,
        sheets: [{ id: sheetId, name: '交叉分析' }],
        regions: [
          {
            id: regionId,
            datasetId,
            sheetId,
            anchor: { row: 2, column: 0 },
            filters: [],
          },
        ],
        cells,
        layoutRules: [
          {
            id: 'merge-title',
            kind: 'merge',
            sheetId,
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 },
            source: 'user',
            sequence: 1,
          },
          {
            id: 'col-w-0',
            kind: 'column-width',
            sheetId,
            index: 0,
            size: 220,
            source: 'preset',
            sequence: 2,
          },
          {
            id: 'col-w-1',
            kind: 'column-width',
            sheetId,
            index: 1,
            size: 140,
            source: 'preset',
            sequence: 3,
          },
        ],
        mergeConfig: {
          capability: 'template-merge-v1',
          identityVersion: 1,
          policies: [
            {
              id: `merge-policy-${rowDimCellId}`,
              sheetId,
              regionId,
              target: {
                kind: 'template-cell',
                templateCellId: rowDimCellId,
                subject: 'row-member-label',
              },
              kind: 'group-span',
              direction: 'vertical',
              enabled: true,
              boundary: 'parent-group',
              source: 'preset',
              sequence: 1,
            },
          ],
          suppressions: [],
        },
        styleRules: [],
        conditionalRules: [],
        instanceOverrides: [],
        orphanedEdits: [],
      };

      onGenerate(newDoc);
    } else if (templateType === 'grouped') {
      // 生成标准层级分组报表 (Grouped List)
      const priField = fields.find((f) => f.key === groupPrimaryDim) || fields[0];
      const secField = fields.find((f) => f.key === groupSecondaryDim);

      const priCellId = `cell-pri-${priField?.key || 'pri'}`;
      const secCellId = secField ? `cell-sec-${secField.key}` : null;

      const cells: CellDefinition[] = [
        {
          id: 'title',
          sheetId,
          position: { row: 0, column: 0 },
          content: { kind: 'literal', value: `${priField?.label || '主分组'} 层级分组统计表` },
          parents: { row: null, column: null },
          style: { bold: true, fontSize: 14, color: '#1677ff' },
        },
        // 表头
        {
          id: 'hdr-pri',
          sheetId,
          position: { row: 2, column: 0 },
          content: { kind: 'literal', value: priField?.label || '主分组' },
          parents: { row: null, column: null },
          style: { bold: true, backgroundColor: '#fafafa' },
        },
      ];

      let colIdx = 1;
      if (secField) {
        cells.push({
          id: 'hdr-sec',
          sheetId,
          position: { row: 2, column: colIdx },
          content: { kind: 'literal', value: secField.label },
          parents: { row: null, column: null },
          style: { bold: true, backgroundColor: '#fafafa' },
        });
        colIdx++;
      }

      groupMeasures.forEach((mKey) => {
        const mField = fields.find((f) => f.key === mKey);
        cells.push({
          id: `hdr-meas-${mKey}`,
          sheetId,
          position: { row: 2, column: colIdx },
          content: { kind: 'literal', value: mField?.label || mKey },
          parents: { row: null, column: null },
          style: { bold: true, backgroundColor: '#fafafa', textAlign: 'right' },
        });
        colIdx++;
      });

      // 数据展开行 (Row 3)
      cells.push({
        id: priCellId,
        sheetId,
        regionId,
        position: { row: 3, column: 0 },
        content: {
          kind: 'field',
          fieldId: resolveFieldId(priField?.key || 'pri'),
          fieldKey: priField?.key || 'pri',
          role: 'row-dimension',
          operation: 'group',
          expand: 'down',
          displayName: priField?.label || '主分组',
        },
        parents: { row: null, column: null },
        style: { bold: true, color: '#0958d9', backgroundColor: '#e6f7ff' },
      });

      colIdx = 1;
      if (secField && secCellId) {
        cells.push({
          id: secCellId,
          sheetId,
          regionId,
          position: { row: 3, column: colIdx },
          content: {
            kind: 'field',
            fieldId: resolveFieldId(secField.key),
            fieldKey: secField.key,
            role: 'row-dimension',
            operation: 'group',
            expand: 'down',
            displayName: secField.label,
          },
          parents: { row: priCellId, column: null },
          style: { color: '#0958d9', backgroundColor: '#f0f5ff' },
        });
        colIdx++;
      }

      groupMeasures.forEach((mKey) => {
        const mField = fields.find((f) => f.key === mKey);
        const isNum = mField?.type === 'number';
        cells.push({
          id: `meas-${mKey}`,
          sheetId,
          regionId,
          position: { row: 3, column: colIdx },
          content: {
            kind: 'field',
            fieldId: resolveFieldId(mKey),
            fieldKey: mKey,
            metricId: resolveMetricId(mKey, isNum ? 'sum' : 'count'),
            role: 'measure',
            operation: isNum ? 'sum' : 'count',
            expand: 'inherit',
            displayName: mField?.label || mKey,
            format: isNum ? 'number' : undefined,
          },
          parents: {
            row: secCellId || priCellId,
            column: null,
          },
          style: { textAlign: 'right', color: '#d46b08', backgroundColor: '#fff7e6' },
        });
        colIdx++;
      });

      const groupedPolicies: DynamicMergePolicy[] = [
        {
          id: `merge-policy-${priCellId}`,
          sheetId,
          regionId,
          target: {
            kind: 'template-cell',
            templateCellId: priCellId,
            subject: 'row-member-label',
          },
          kind: 'group-span',
          direction: 'vertical',
          enabled: true,
          boundary: 'parent-group',
          source: 'preset',
          sequence: 1,
        },
      ];
      if (secField && secCellId) {
        groupedPolicies.push({
          id: `merge-policy-${secCellId}`,
          sheetId,
          regionId,
          target: {
            kind: 'template-cell',
            templateCellId: secCellId,
            subject: 'row-member-label',
          },
          kind: 'group-span',
          direction: 'vertical',
          enabled: true,
          boundary: 'parent-group',
          source: 'preset',
          sequence: 2,
        });
      }

      const newDoc: CellTemplateDocumentV1 = {
        documentType: 'cell-template',
        schemaVersion: '2.0',
        capabilitiesVersion: 'cell-expansion-v2',
        id: `template-${Date.now()}`,
        title: `${priField?.label || '主分组'} 层级分组报表`,
        templateRevision: 1,
        sheets: [{ id: sheetId, name: '分组统计' }],
        regions: [
          {
            id: regionId,
            datasetId,
            sheetId,
            anchor: { row: 2, column: 0 },
            filters: [],
          },
        ],
        cells,
        layoutRules: [
          {
            id: 'merge-title',
            kind: 'merge',
            sheetId,
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: colIdx - 1 },
            source: 'user',
            sequence: 1,
          },
          {
            id: 'col-w-0',
            kind: 'column-width',
            sheetId,
            index: 0,
            size: 220,
            source: 'preset',
            sequence: 2,
          },
          ...(secField ? [{
            id: 'col-w-1',
            kind: 'column-width' as const,
            sheetId,
            index: 1,
            size: 140,
            source: 'preset' as const,
            sequence: 3,
          }] : []),
        ],
        mergeConfig: {
          capability: 'template-merge-v1',
          identityVersion: 1,
          legacyFallback: 'explicit-only',
          policies: groupedPolicies,
          suppressions: [],
        },
        styleRules: [],
        conditionalRules: [],
        instanceOverrides: [],
        orphanedEdits: [],
      };

      onGenerate(newDoc);
    } else if (templateType === 'detail') {
      let selectedFieldObjs = detailFields
        .map((k) => fields.find((f) => f.key === k))
        .filter(Boolean) as FieldItem[];
      if (selectedFieldObjs.length === 0) {
        selectedFieldObjs = fields.slice(0, 5);
      }

      const cells: CellDefinition[] = [];
      const titleCellId = 'cell-title';

      cells.push({
        id: titleCellId,
        sheetId,
        position: { row: 0, column: 0 },
        parents: { row: null, column: null },
        content: {
          kind: 'literal',
          value: `${datasetName} 业务明细流水清单`,
        },
        style: {
          bold: true,
          fontSize: 14,
          color: '#1d39c4',
          textAlign: 'center',
          verticalAlign: 'middle',
        },
      });

      const masterDriverId = `cell-detail-${selectedFieldObjs[0]?.key || 'd0'}`;

      selectedFieldObjs.forEach((f, idx) => {
        // 表头行 (Row 2)
        cells.push({
          id: `cell-header-${f.key}`,
          sheetId,
          regionId,
          position: { row: 2, column: idx },
          parents: { row: null, column: null },
          content: { kind: 'literal', value: f.label || f.key },
          style: {
            bold: true,
            backgroundColor: '#f5f5f5',
            textAlign: f.type === 'number' ? 'right' : 'center',
            verticalAlign: 'middle',
          },
        });

        // 明细流水行 (Row 3, 逐行向下展开)
        cells.push({
          id: idx === 0 ? masterDriverId : `cell-detail-${f.key}`,
          sheetId,
          regionId,
          position: { row: 3, column: idx },
          content: {
            kind: 'field',
            fieldId: resolveFieldId(f.key),
            fieldKey: f.key,
            displayName: f.label || f.key,
            role: 'detail-column',
            operation: 'list',
            expand: 'down',
          },
          parents: {
            row: idx === 0 ? 'none' : masterDriverId,
            column: 'none',
          },
          style: {
            textAlign: f.type === 'number' ? 'right' : 'left',
            verticalAlign: 'middle',
          },
        });
      });

      const newDoc: CellTemplateDocumentV1 = {
        id: `wizard-detail-${Date.now()}`,
        title: `${datasetName} 业务明细清单`,
        documentType: 'cell-template',
        schemaVersion: '2.0',
        capabilitiesVersion: 'cell-expansion-v2',
        templateRevision: 1,
        sheets: [{ id: sheetId, name: 'Sheet1' }],
        regions: [
          {
            id: regionId,
            sheetId,
            datasetId: datasetId || 'default',
            anchor: { row: 2, column: 0 },
            filters: [],
          },
        ],
        cells,
        layoutRules: [
          {
            id: 'merge-title',
            kind: 'merge',
            sheetId,
            range: {
              startRow: 0,
              endRow: 0,
              startColumn: 0,
              endColumn: Math.max(0, selectedFieldObjs.length - 1),
            },
            source: 'user',
            sequence: 1,
          },
          ...selectedFieldObjs.map((_, idx) => ({
            id: `col-w-${idx}`,
            kind: 'column-width' as const,
            sheetId,
            index: idx,
            size: 140,
            source: 'preset' as const,
            sequence: idx + 2,
          })),
        ],
        mergeConfig: {
          capability: 'template-merge-v1',
          identityVersion: 1,
          policies: [],
          suppressions: [],
        },
        styleRules: [],
        conditionalRules: [],
        instanceOverrides: [],
        orphanedEdits: [],
      };

      onGenerate(newDoc);
    }
  };

  return (
    <Modal
      open={open}
      destroyOnClose
      title={
        <Space size={8}>
          <ThunderboltOutlined style={{ color: '#722ed1', fontSize: 18 }} />
          <span>报表排版向导 (自动生成标准单元格结构)</span>
        </Space>
      }
      width={640}
      okText="一键生成报表结构"
      cancelText="取消"
      onOk={handleConfirm}
      onCancel={onCancel}
    >
      <div
        style={{
          marginBottom: 12,
          padding: '8px 12px',
          backgroundColor: '#f0f5ff',
          borderRadius: 6,
          border: '1px solid #d6e4ff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 13 }}>当前数据源：</Text>
          <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>
            {datasetName || datasetId}
          </Tag>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {fields.length} 个可用字段
        </Text>
      </div>

      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        选定维度与指标，系统将严格遵循单元格驱动引擎的<strong>正交双父格与扩展依赖规则</strong>，为您自动排布好表头、维度格、指标格及其父格绑定。
      </Paragraph>

      <Form layout="vertical" size="small">
        <Form.Item label="报表原型模式" style={{ marginBottom: 16 }}>
          <Radio.Group
            value={templateType}
            onChange={(e) => setTemplateType(e.target.value)}
            buttonStyle="solid"
          >
            <Radio.Button value="pivot">
              <Space size={4}>
                <TableOutlined />
                <span>双向交叉报表 (FineReport 核心模式)</span>
              </Space>
            </Radio.Button>
            <Radio.Button value="grouped">
              <Space size={4}>
                <AppstoreOutlined />
                <span>层级分组报表 (多级展开)</span>
              </Space>
            </Radio.Button>
            <Radio.Button value="detail">
              <Space size={4}>
                <UnorderedListOutlined />
                <span>清单明细报表 (逐行流水清单)</span>
              </Space>
            </Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Card size="small" style={{ backgroundColor: '#fafafa', marginBottom: 12 }}>
          {templateType === 'pivot' ? (
            <>
              <Form.Item label="行维度 (向下扩展)" style={{ marginBottom: 12 }}>
                <Select
                  value={pivotRowDim}
                  onChange={(val) => {
                    setPivotRowDim(val);
                    if (pivotColDim === val) {
                      const nextCol = fields.find((f) => f.key !== val)?.key || '';
                      setPivotColDim(nextCol);
                    }
                  }}
                  options={fields.map((f) => ({ label: `${f.label} (${f.key})`, value: f.key }))}
                  placeholder="选择行分组维度（如车间）"
                />
              </Form.Item>

              <Form.Item label="列维度 (向右扩展)" style={{ marginBottom: 12 }}>
                <Select
                  value={pivotColDim}
                  onChange={setPivotColDim}
                  options={fields.map((f) => ({ label: `${f.label} (${f.key})`, value: f.key }))}
                  placeholder="选择列分组维度（如日期或月份）"
                />
              </Form.Item>

              {fields.find((f) => f.key === pivotColDim)?.type === 'date' && (
                <Form.Item label="列维度时间分桶粒度" style={{ marginBottom: 12 }}>
                  <Radio.Group
                    value={pivotTimeBucket}
                    onChange={(e) => setPivotTimeBucket(e.target.value)}
                  >
                    <Radio value="month">按月统计 (Month)</Radio>
                    <Radio value="day">按日统计 (Day)</Radio>
                    <Radio value="none">原始时间 (不分桶)</Radio>
                  </Radio.Group>
                </Form.Item>
              )}

              <Form.Item
                label={
                  <Space size={6}>
                    <span>统计指标 (交叉计算，自动绑定双父格)</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      推荐勾选数值型度量
                    </Text>
                  </Space>
                }
                style={{ marginBottom: 8 }}
              >
                <Checkbox.Group
                  value={pivotMeasures}
                  onChange={(vals) => setPivotMeasures(vals as string[])}
                >
                  <Space wrap size={[12, 8]}>
                    {fields.map((f) => {
                      const isNum = f.type === 'number';
                      return (
                        <Checkbox key={f.key} value={f.key}>
                          <span>{f.label}</span>
                          <span
                            style={{
                              fontSize: 11,
                              marginLeft: 4,
                              padding: '1px 5px',
                              borderRadius: 3,
                              color: isNum ? '#0958d9' : '#8c8c8c',
                              backgroundColor: isNum ? '#e6f4ff' : '#f5f5f5',
                            }}
                          >
                            {isNum ? 'SUM' : 'COUNT'}
                          </span>
                        </Checkbox>
                      );
                    })}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
            </>
          ) : templateType === 'grouped' ? (
            <>
              <Form.Item label="一级分组维度" style={{ marginBottom: 12 }}>
                <Select
                  value={groupPrimaryDim}
                  onChange={(val) => {
                    setGroupPrimaryDim(val);
                    if (groupSecondaryDim === val) {
                      setGroupSecondaryDim('');
                    }
                  }}
                  options={fields.map((f) => ({ label: `${f.label} (${f.key})`, value: f.key }))}
                  placeholder="选择一级分组维度（如承制车间）"
                />
              </Form.Item>

              <Form.Item label="二级分组维度 (选填)" style={{ marginBottom: 12 }}>
                <Select
                  allowClear
                  value={groupSecondaryDim}
                  onChange={setGroupSecondaryDim}
                  options={fields.filter((f) => f.key !== groupPrimaryDim).map((f) => ({ label: `${f.label} (${f.key})`, value: f.key }))}
                  placeholder="可选择二级分组（如加工工件名称）"
                />
              </Form.Item>

              <Form.Item
                label={
                  <Space size={6}>
                    <span>统计指标</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      推荐勾选数值型度量
                    </Text>
                  </Space>
                }
                style={{ marginBottom: 8 }}
              >
                <Checkbox.Group
                  value={groupMeasures}
                  onChange={(vals) => setGroupMeasures(vals as string[])}
                >
                  <Space wrap size={[12, 8]}>
                    {fields.map((f) => {
                      const isNum = f.type === 'number';
                      return (
                        <Checkbox key={f.key} value={f.key}>
                          <span>{f.label}</span>
                          <span
                            style={{
                              fontSize: 11,
                              marginLeft: 4,
                              padding: '1px 5px',
                              borderRadius: 3,
                              color: isNum ? '#0958d9' : '#8c8c8c',
                              backgroundColor: isNum ? '#e6f4ff' : '#f5f5f5',
                            }}
                          >
                            {isNum ? 'SUM' : 'COUNT'}
                          </span>
                        </Checkbox>
                      );
                    })}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                label={
                  <Space size={6}>
                    <span>选择展示明细字段 (按勾选顺序输出列，支持自由排列)</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      逐行明细流水展示
                    </Text>
                  </Space>
                }
                style={{ marginBottom: 12 }}
              >
                <Checkbox.Group
                  value={detailFields}
                  onChange={(vals) => setDetailFields(vals as string[])}
                >
                  <Space wrap size={[12, 8]}>
                    {fields.map((f) => (
                      <Checkbox key={f.key} value={f.key}>
                        <span>{f.label}</span>
                        <span style={{ fontSize: 11, color: '#8c8c8c', marginLeft: 4 }}>
                          ({f.key})
                        </span>
                      </Checkbox>
                    ))}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
            </>
          )}
        </Card>
      </Form>
    </Modal>
  );
};
