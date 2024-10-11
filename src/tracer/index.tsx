/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { FunctionComponent, h, render } from 'preact';
import { useState } from 'preact/hooks';
import type { HTMLTraceEpoch, IHTMLTraceRenderData } from '../base/htmlTracerTypes';
import { useDebouncedCallback } from './hooks';
import './index.css';
import { Root } from './node';

declare const DEFAULT_MODEL: IHTMLTraceRenderData;
declare const EPOCHS: HTMLTraceEpoch[];
declare const DEFAULT_TOKENS: number;
declare const SERVER_ADDRESS: number;

const SliderWithInputControl: FunctionComponent<{ label: string; value: number; onChange: (newTokens: number) => void; min: number; max: number }> = ({ label, value, onChange, min, max }) => {
	const handleSliderChange = (event: Event) => {
		onChange((event.target as HTMLInputElement).valueAsNumber);
	};
	const id = `number-slider-${Math.random()}`;

	return (
		<div className="controls-slider">
			<label htmlFor={id}>{label}</label>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				value={value}
				onInput={handleSliderChange}
			/>
			<input
				type="number"
				min={min}
				value={value}
				onInput={handleSliderChange}
				onChange={handleSliderChange}
			/>
		</div>
	);
};

const ScoreByControl: FunctionComponent<{ scoreBy: 'priority' | 'tokens', onScoreByChange: (newScoreBy: 'priority' | 'tokens') => void }> = ({ scoreBy, onScoreByChange }) => {
	const handleScoreByChange = (event: Event) => {
		const newScoreBy = (event.target as HTMLInputElement).value as 'priority' | 'tokens';
		onScoreByChange(newScoreBy);
	};

	return (
		<div className="controls-scoreby">
			Visualize by
			<label>
				<input
					type="radio"
					name="scoreBy"
					value="tokens"
					checked={scoreBy === 'tokens'}
					onChange={handleScoreByChange}
				/>
				Tokens
			</label>
			<label>
				<input
					type="radio"
					name="scoreBy"
					value="priority"
					checked={scoreBy === 'priority'}
					onChange={handleScoreByChange}
				/>
				Priority
			</label>
		</div>
	);
};

const App = () => {
	const [tokens, setTokens] = useState(DEFAULT_TOKENS);
	const [epoch, setEpoch] = useState(EPOCHS.length);
	const [model, setModel] = useState<IHTMLTraceRenderData>(DEFAULT_MODEL);
	const [scoreBy, setScoreBy] = useState<'priority' | 'tokens'>('tokens');

	const regenModel = useDebouncedCallback(async (tokens: number) => {
		if (tokens === DEFAULT_TOKENS) {
			return DEFAULT_MODEL;
		}
		const response = await fetch(`${SERVER_ADDRESS}regen?n=${tokens}`);
		const newModel = await response.json();
		setModel(newModel);
	}, 100);

	const handleTokensChange = (newTokens: number) => {
		setTokens(newTokens);
		regenModel(newTokens);
	};

	return (
		<div className="app">
			<div className="controls">
				<SliderWithInputControl label='Render Epoch' value={epoch} onChange={setEpoch} min={0} max={EPOCHS.length} />
				{epoch !== EPOCHS.length && <p>Changing the render epoch lets you see the order in which elements are rendered and how the token budget is allocated.</p>}
				<SliderWithInputControl label='Token Budget' value={tokens} onChange={handleTokensChange} min={0} max={DEFAULT_TOKENS * 2} />
				{tokens !== DEFAULT_TOKENS && <p>Token changes here will prune elements and re-render 'pure' ones, but the entire prompt is not being re-rendered</p>}
				<div className='controls-stats'>
					<span>Used {model.container.tokens}/{model.budget} tokens</span>
					<span>Removed {model.removed} nodes</span>
					<ScoreByControl scoreBy={scoreBy} onScoreByChange={setScoreBy} />
				</div>
			</div>
			<Root node={model.container} scoreBy={scoreBy} epoch={epoch} />
		</div>
	);
};

render(<App />, document.body);
