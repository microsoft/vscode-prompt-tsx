/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ITracer } from './tracer';

/**
 * Handler that can trace rendering internals into an HTML summary.
 */
export class HTMLTracer implements ITracer {
	private readonly entities: string[] = [];
	private value = '';

	private elementStack: { hadChildren: boolean }[] = [];

	public startRenderPass(): void {
		const stackElem = this.elementStack[this.elementStack.length - 1];
		if (stackElem && !stackElem.hadChildren) {
			stackElem.hadChildren = true;
			this.value += `<details><summary>Children</summary>`;
		}

		this.value += `<div class="render-pass">`;
	}
	public startRenderFlex(group: number, reserved: number, remainingTokenBudget: number): void {
		this.value += `<h2>flexGrow=${group}</h2><div class="render-flex"><p>${reserved} tokens reserved, ${remainingTokenBudget} tokens to split between children</p>`;
	}
	public didRenderElement(name: string, literals: string[]): void {
		this.value += `<h3>${this.entity(`<${name} />`)}</h3><div class="render-element">`;
		if (literals.length) {
			this.value += `<ul class="literals">${literals.map(l => this.entity(l.replace(/\n/g, '\\n'), 'li')).join('')}</ul>`;
		}
		this.elementStack.push({ hadChildren: false });
	}
	public didRenderChildren(tokensConsumed: number): void {
		if (this.elementStack.pop()!.hadChildren) {
			this.value += `</details>`;
		}
		if (tokensConsumed) {
			this.value += `<p>${tokensConsumed} tokens consumed by children</p></div>`;
		}
	}
	public endRenderFlex(): void {
		this.value += '</div>';
	}
	public endRenderPass(): void {
		this.value += '</div>';
	}

	public toHTML() {
		return this.value +
			`<script>const ents = ${JSON.stringify(this.entities)}; for (let i = 0; i < ents.length; i++) document.querySelector('.entity-' + i).innerText = ents[i]; </script>` +
			`<style>${style}</style>`;
	}

	private entity(s: string, tag = 'span') {
		this.entities.push(s);
		return `<${tag} class="entity-${this.entities.length - 1}"></${tag}>`;
	}
}

const style = `body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif;
}

.render-pass {
  padding: 4px;
  border-left: 2px solid #ccc;

  &:hover {
    border-left-color: #000;
  }
}

.literals li {
  white-space: pre;
  font-family: monospace;
}

.render-flex, .render-element {
  padding-left: 10px;
}`;
