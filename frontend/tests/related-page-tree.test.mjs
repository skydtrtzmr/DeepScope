import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relatedDirectory } from '../src/components/knowledge/related-page-tree.ts';

const staff = { id: '/员工', title: '员工' };
const page = (id, frontmatter) => ({ id, title: id, type: 'entity', subject: staff, frontmatter });

test('shows subjects and skips dimensions that cannot split the related pages', () => {
  const pages = [
    page('郑国栋', { 专业: '仪控' }),
    { id: 'tags/自主处理', title: '自主处理', type: 'tag', subject: null },
  ];
  const result = relatedDirectory(pages, ['专业', '部门', 'type'], 1);
  assert.deepEqual(result.groups.map(group => group.title), ['员工', '标签']);
  for (const [i, group] of result.groups.entries()) {
    assert.deepEqual(group.children.groups, []);
    assert.deepEqual(group.children.pages, [pages[i]]);
  }
});

test('labels meaningful dimensions and keeps missing values at the end', () => {
  const pages = ['运行', '检修', '检修', '运行', undefined, undefined].map((部门, id) =>
    page(String(id), { 专业: '仪控', 部门, type: [''] }));
  const [subject] = relatedDirectory(pages, ['专业', '部门', 'type'], 1).groups;
  assert.deepEqual(subject.children.groups.map(group => [group.field, group.title, group.count]), [
    ['部门', '检修', 2], ['部门', '运行', 2], ['部门', '未分类', 2],
  ]);
  assert.ok(subject.children.groups.every(group => group.children.groups.length === 0));
});
