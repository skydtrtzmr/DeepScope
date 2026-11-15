import { graphFromModelRows, type SubjectModel } from './subject-graph';

// Synthetic records in the existing model shape, not an export of warehouse data.
export const models: SubjectModel[] = [
  { ID: 'employee', NAME: '人员', NAMETEMPLATE: '{{name}}', items: [
    { FIELD: 'id', ENTITYTYPE: 'primary' }, { FIELD: 'name', LABEL: '姓名' },
  ] },
  { ID: 'task', NAME: '任务', NAMETEMPLATE: '{{name}}', items: [
    { FIELD: 'id', ENTITYTYPE: 'primary' }, { FIELD: 'name', LABEL: '任务名称' },
    { FIELD: 'owner_id', ENTITYTYPE: 'foreign', ENTITYDESC: '负责人', TARGET: 'employee', TARGETFIELD: 'id' },
    { FIELD: 'reviewer_id', ENTITYTYPE: 'foreign', ENTITYDESC: '审核人', TARGET: 'employee', TARGETFIELD: 'id' },
  ] },
];
export const subjectDemo = graphFromModelRows(models, {
  employee: [{ id: '001', name: '张三' }, { id: '002', name: '李四' }],
  task: [
    { id: '001', name: '共享任务', owner_id: '001', reviewer_id: '002' },
    { id: '002', name: '同人负责并审核', owner_id: '001', reviewer_id: '001' },
    { id: '003', name: '李四的任务', owner_id: '002', reviewer_id: null },
  ],
});
