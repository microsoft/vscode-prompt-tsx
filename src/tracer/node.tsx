/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { FunctionComponent, h } from 'preact';
import { useState } from 'preact/hooks';
import {
	HTMLTraceEpoch,
	ITraceMaterializedChatMessage,
	ITraceMaterializedChatMessageTextChunk,
	ITraceMaterializedContainer,
	ITraceMaterializedNode,
	TraceMaterializedNodeType,
} from '../base/htmlTracerTypes';
import { Integer } from './i18n';

declare const EPOCHS: HTMLTraceEpoch[];

const RANGE_COLORS = [
	{ bg: '#c1e7ff', fg: '#000' },
	{ bg: '#abd2ec', fg: '#000' },
	{ bg: '#94bed9', fg: '#000' },
	{ bg: '#7faac6', fg: '#000' },
	{ bg: '#6996b3', fg: '#fff' },
	{ bg: '#5383a1', fg: '#fff' },
	{ bg: '#3d708f', fg: '#fff' },
	{ bg: '#255e7e', fg: '#fff' },
];

type ScoreField = { field: 'priority' | 'tokens'; min: number; max: number };

const Children: FunctionComponent<{
	scoreBy: ScoreField;
	nodes: ITraceMaterializedNode[];
	epoch: number;
}> = ({ scoreBy, nodes, epoch }) => {
	if (nodes.length === 0) {
		return null;
	}

	let nextScoreBy = scoreBy;
	// priority is always scored relative to the container, while tokens are global
	if (scoreBy.field !== 'tokens') {
		let max = nodes[0][scoreBy.field];
		let min = nodes[0][scoreBy.field];
		for (let i = 1; i < nodes.length; i++) {
			max = Math.max(max, nodes[i][scoreBy.field]);
			min = Math.max(min, nodes[i][scoreBy.field]);
		}
		nextScoreBy = { field: scoreBy.field, max, min };
	}

	return (
		<div className="node-children">
			{nodes.map((child, index) =>
				child.type === TraceMaterializedNodeType.TextChunk ? (
					<TextNode scoreBy={nextScoreBy} key={index} node={child} />
				) : (
					<WrapperNode scoreBy={nextScoreBy} key={index} node={child} epoch={epoch} />
				)
			)}
		</div>
	);
};

const LNNodeStats: FunctionComponent<{ node: ITraceMaterializedNode }> = ({ node }) => (
	<div className="node-stats">
		Used Tokens: <Integer value={node.tokens} />
		{' / '}
		Priority:{' '}
		{node.priority === Number.MAX_SAFE_INTEGER ? 'MAX' : <Integer value={node.priority} />}
	</div>
);

const LMNode: FunctionComponent<
	{ scoreBy: ScoreField; node: ITraceMaterializedNode } & h.JSX.HTMLAttributes<HTMLDivElement>
> = ({ scoreBy, node, children, ...attrs }) => {
	let step = 0;
	if (scoreBy.max !== scoreBy.min) {
		const pct = (node[scoreBy.field] - scoreBy.min) / (scoreBy.max - scoreBy.min);
		step = Math.round((RANGE_COLORS.length - 1) * pct);
	}

	return (
		<div
			{...attrs}
			className={`node ${attrs.className || ''}`}
			style={{ backgroundColor: RANGE_COLORS[step].bg, color: RANGE_COLORS[step].fg }}
		>
			{children}
		</div>
	);
};

const TextNode: FunctionComponent<{
	scoreBy: ScoreField;
	node: ITraceMaterializedChatMessageTextChunk;
}> = ({ scoreBy, node }) => {
	return (
		<LMNode node={node} scoreBy={scoreBy} tabIndex={0} className="node-text">
			<LNNodeStats node={node} />
			<div className="node-content">{node.value}</div>
		</LMNode>
	);
};

const WrapperNode: FunctionComponent<{
	scoreBy: ScoreField;
	node: ITraceMaterializedContainer | ITraceMaterializedChatMessage;
	epoch: number;
}> = ({ scoreBy, node, epoch }) => {
	const [collapsed, setCollapsed] = useState(false);
	const epochIndex = EPOCHS.findIndex(e => e.elements.some(e => e.id === node.id));
	if (epochIndex === undefined) {
		throw new Error(`epoch not found for ${node.id}`);
	}
	const myEpoch = EPOCHS[epochIndex];
	const thisEpoch = EPOCHS.at(epoch);
	const tokenBudget = myEpoch.elements.find(e => e.id === node.id)!.tokenBudget;
	const tag =
		node.type === TraceMaterializedNodeType.ChatMessage
			? node.name || node.role.slice(0, 1).toUpperCase() + node.role.slice(1) + 'Message'
			: node.name;

	const className =
		epochIndex === epoch ? 'new-in-epoch' : epoch < epochIndex ? 'before-epoch' : '';

	return (
		<LMNode node={node} scoreBy={scoreBy} className={className}>
			<LNNodeStats node={node} />
			<div className="node-content node-toggler" onClick={() => setCollapsed(v => !v)}>
				<span>
					{thisEpoch?.inNode === node.id ? '🏃 ' : ''}
					{`<${tag}>`}
				</span>
				<span className="indicator">{collapsed ? '[+]' : '[-]'}</span>
			</div>
			{epoch === epochIndex && (
				<div className="node-stats">
					Token Budget: <Integer value={tokenBudget} />
				</div>
			)}
			{thisEpoch?.inNode === node.id && (
				<div className="node-stats">
					Rendering flexGrow={thisEpoch.flexValue}
					<br />
					<br />
					Splitting{' '}
					{thisEpoch.reservedTokens
						? `${thisEpoch.tokenBudget} - ${thisEpoch.reservedTokens} (reserved) = `
						: ''}
					<Integer value={thisEpoch.tokenBudget} /> tokens among {thisEpoch.elements.length}{' '}
					elements
				</div>
			)}
			{!collapsed && <Children nodes={node.children} scoreBy={scoreBy} epoch={epoch} />}
		</LMNode>
	);
};

export const Root: FunctionComponent<{
	scoreBy: 'priority' | 'tokens';
	node: ITraceMaterializedContainer;
	epoch: number;
}> = ({ scoreBy, node, epoch }) => {
	let score: ScoreField;
	if (scoreBy === 'tokens') {
		score = { field: 'tokens', max: node.tokens, min: 0 };
	} else {
		score = { field: 'priority', max: node.priority, min: node.priority };
	}

	return <WrapperNode scoreBy={score} node={node} epoch={epoch} />;
};
