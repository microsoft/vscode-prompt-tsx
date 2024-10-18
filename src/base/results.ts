/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Location, ThemeIcon, Uri } from 'vscode';
import * as JSON from './jsonTypes';
import { URI } from './util/vs/common/uri';

/**
 * Arbitrary metadata which can be retrieved after the prompt is rendered.
 */
export abstract class PromptMetadata {
	readonly _marker: undefined;
	toString(): string {
		return Object.getPrototypeOf(this).constructor.name;
	}
}

export enum ChatResponseReferencePartStatusKind {
	Complete = 1,
	Partial = 2,
	Omitted = 3,
}

/**
 * A reference used for creating the prompt.
 */
export class PromptReference {
	public static fromJSON(json: JSON.PromptReferenceJSON): PromptReference {
		// todo@connor4312: do we need to create concrete Location/Range types?
		const uriOrLocation = (v: JSON.UriOrLocationJSON): Uri | Location =>
			'scheme' in v ? URI.from(v) : { uri: URI.from(v.uri), range: v.range };

		return new PromptReference(
			'variableName' in json.anchor
				? {
						variableName: json.anchor.variableName,
						value: json.anchor.value && uriOrLocation(json.anchor.value),
				  }
				: uriOrLocation(json.anchor),
			json.iconPath &&
				('scheme' in json.iconPath
					? URI.from(json.iconPath)
					: 'light' in json.iconPath
					? { light: URI.from(json.iconPath.light), dark: URI.from(json.iconPath.dark) }
					: json.iconPath),
			json.options
		);
	}

	constructor(
		readonly anchor: Uri | Location | { variableName: string; value?: Uri | Location },
		readonly iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri },
		readonly options?: {
			status?: { description: string; kind: ChatResponseReferencePartStatusKind };
			internal?: boolean;
		}
	) {}

	public toJSON(): JSON.PromptReferenceJSON {
		return {
			anchor: this.anchor,
			iconPath: this.iconPath,
			options: this.options,
		};
	}
}
