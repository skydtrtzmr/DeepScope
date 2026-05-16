import type { GraphData } from '@/types/graph';

// 示例图谱数据：模拟一个知识图谱
export const DEMO_GRAPH_DATA: GraphData = {
  nodes: [
    // 核心人物
    { id: 'person-1', label: '张三', type: 'person', description: '核心人物，项目负责人' },
    { id: 'person-2', label: '李四', type: 'person', description: '技术总监' },
    { id: 'person-3', label: '王五', type: 'person', description: '产品经理' },
    { id: 'person-4', label: '赵六', type: 'person', description: '设计师' },
    { id: 'person-5', label: '钱七', type: 'person', description: '前端开发工程师' },
    { id: 'person-6', label: '孙八', type: 'person', description: '后端开发工程师' },
    { id: 'person-7', label: '周九', type: 'person', description: '测试工程师' },
    { id: 'person-8', label: '吴十', type: 'person', description: '运维工程师' },

    // 组织
    { id: 'org-1', label: '技术部', type: 'organization', description: '负责技术研发' },
    { id: 'org-2', label: '产品部', type: 'organization', description: '负责产品设计' },
    { id: 'org-3', label: '公司总部', type: 'organization', description: '集团总公司' },

    // 项目
    { id: 'event-1', label: 'A项目', type: 'event', description: '重点研发项目，2024年启动' },
    { id: 'event-2', label: 'B项目', type: 'event', description: '维护项目' },
    { id: 'event-3', label: 'C项目', type: 'event', description: '新孵化项目' },

    // 技术概念
    { id: 'concept-1', label: 'React', type: 'concept', description: '前端框架' },
    { id: 'concept-2', label: 'Node.js', type: 'concept', description: '后端运行时' },
    { id: 'concept-3', label: 'TypeScript', type: 'concept', description: '编程语言' },
    { id: 'concept-4', label: 'GraphQL', type: 'concept', description: 'API 查询语言' },
    { id: 'concept-5', label: 'Docker', type: 'concept', description: '容器化技术' },

    // 文档
    { id: 'doc-1', label: '技术方案文档', type: 'document', description: 'A项目技术方案' },
    { id: 'doc-2', label: '需求文档', type: 'document', description: 'A项目需求说明' },
    { id: 'doc-3', label: '设计稿', type: 'document', description: 'UI设计文件' },

    // 地点
    { id: 'loc-1', label: '北京办公室', type: 'location', description: '总部所在地' },
    { id: 'loc-2', label: '上海办公室', type: 'location', description: '华东区域中心' },
  ],
  edges: [
    // 人员关系
    { id: 'e1', source: 'person-1', target: 'person-2', label: '管理' },
    { id: 'e2', source: 'person-1', target: 'person-3', label: '协作' },
    { id: 'e3', source: 'person-2', target: 'person-5', label: '指导' },
    { id: 'e4', source: 'person-2', target: 'person-6', label: '指导' },
    { id: 'e5', source: 'person-3', target: 'person-4', label: '协作' },
    { id: 'e6', source: 'person-5', target: 'person-7', label: '协作' },
    { id: 'e7', source: 'person-6', target: 'person-8', label: '协作' },

    // 组织归属
    { id: 'e8', source: 'person-1', target: 'org-1', label: '隶属' },
    { id: 'e9', source: 'person-2', target: 'org-1', label: '隶属' },
    { id: 'e10', source: 'person-5', target: 'org-1', label: '隶属' },
    { id: 'e11', source: 'person-6', target: 'org-1', label: '隶属' },
    { id: 'e12', source: 'person-3', target: 'org-2', label: '隶属' },
    { id: 'e13', source: 'person-4', target: 'org-2', label: '隶属' },
    { id: 'e14', source: 'org-1', target: 'org-3', label: '下属' },
    { id: 'e15', source: 'org-2', target: 'org-3', label: '下属' },

    // 项目参与
    { id: 'e16', source: 'person-1', target: 'event-1', label: '负责' },
    { id: 'e17', source: 'person-2', target: 'event-1', label: '参与' },
    { id: 'e18', source: 'person-3', target: 'event-1', label: '参与' },
    { id: 'e19', source: 'person-5', target: 'event-1', label: '开发' },
    { id: 'e20', source: 'person-6', target: 'event-1', label: '开发' },
    { id: 'e21', source: 'person-4', target: 'event-1', label: '设计' },
    { id: 'e22', source: 'person-7', target: 'event-1', label: '测试' },
    { id: 'e23', source: 'person-2', target: 'event-2', label: '负责' },
    { id: 'e24', source: 'person-6', target: 'event-2', label: '维护' },
    { id: 'e25', source: 'person-3', target: 'event-3', label: '规划' },

    // 技术栈
    { id: 'e26', source: 'event-1', target: 'concept-1', label: '使用' },
    { id: 'e27', source: 'event-1', target: 'concept-2', label: '使用' },
    { id: 'e28', source: 'event-1', target: 'concept-3', label: '使用' },
    { id: 'e29', source: 'event-1', target: 'concept-4', label: '使用' },
    { id: 'e30', source: 'event-2', target: 'concept-5', label: '使用' },
    { id: 'e31', source: 'person-5', target: 'concept-1', label: '擅长' },
    { id: 'e32', source: 'person-5', target: 'concept-3', label: '擅长' },
    { id: 'e33', source: 'person-6', target: 'concept-2', label: '擅长' },
    { id: 'e34', source: 'person-8', target: 'concept-5', label: '擅长' },

    // 文档关联
    { id: 'e35', source: 'event-1', target: 'doc-1', label: '产出' },
    { id: 'e36', source: 'event-1', target: 'doc-2', label: '产出' },
    { id: 'e37', source: 'event-1', target: 'doc-3', label: '产出' },
    { id: 'e38', source: 'person-2', target: 'doc-1', label: '编写' },
    { id: 'e39', source: 'person-3', target: 'doc-2', label: '编写' },
    { id: 'e40', source: 'person-4', target: 'doc-3', label: '设计' },

    // 地点关联
    { id: 'e41', source: 'org-3', target: 'loc-1', label: '位于' },
    { id: 'e42', source: 'org-1', target: 'loc-1', label: '位于' },
    { id: 'e43', source: 'org-2', target: 'loc-2', label: '位于' },
  ],
};
