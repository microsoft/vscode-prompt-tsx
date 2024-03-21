/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptReference } from "../results";
import { ResourceMap } from "./vs/common/map";
import type { Range, Uri, Location } from 'vscode';

export function getUniqueReferences(references: PromptReference[]): PromptReference[] {
	const groupedPromptReferences: ResourceMap<PromptReference[] | PromptReference> = new ResourceMap();

	const getCombinedRange = (a: Range, b: Range): Range | undefined => {
		if (a.contains(b)) {
			return a;
		}

		if (b.contains(a)) {
			return b;
		}

		const [firstRange, lastRange] = (a.start.line < b.start.line) ? [a, b] : [b, a];
		// check if a is before b
		if (firstRange.end.line >= (lastRange.start.line - 1)) {
			const vscode = require('vscode');
			return new vscode.Range(firstRange.start, lastRange.end);
		}

		return undefined;
	};

	// remove overlaps from within the same promptContext
	references.forEach(targetReference => {
		const refAnchor = targetReference.anchor;
		if (!isLocation(refAnchor)) {
			groupedPromptReferences.set(refAnchor, targetReference);
		} else {
			// reference is a range
			const existingRefs = groupedPromptReferences.get(refAnchor.uri);
			if (!existingRefs) {
				groupedPromptReferences.set(refAnchor.uri, [targetReference]);
			} else if (!(existingRefs instanceof PromptReference)) {
				// check if existingRefs isn't already a full file
				const oldLocationsToKeep: Location[] = [];
				let newRange = refAnchor.range;
				existingRefs.forEach(existingRef => {
					if (!isLocation(existingRef.anchor)) {
						// this shouldn't be the case, since all PromptReferences added as part of an array should be ranges
						return;
					}
					const combinedRange = getCombinedRange(newRange, existingRef.anchor.range);
					if (combinedRange) {
						// if we can consume this range, incorporate it into the new range and don't add it to the locations to keep
						newRange = combinedRange;
					} else {
						oldLocationsToKeep.push(existingRef.anchor);
					}
				});
				const newRangeLocation: Location = {
					uri: refAnchor.uri,
					range: newRange,
				};
				groupedPromptReferences.set(
					refAnchor.uri,
					[...oldLocationsToKeep, newRangeLocation]
						.sort((a, b) => a.range.start.line - b.range.start.line || a.range.end.line - b.range.end.line)
						.map(location => new PromptReference(location)));

			}
		}
	});

	// sort values
	const finalValues = Array.from(groupedPromptReferences.keys())
		.sort((a, b) => a.fsPath.localeCompare(b.fsPath))
		.map(e => {
			const values = groupedPromptReferences.get(e);
			if (!values) {
				// should not happen, these are all keys
				return [];
			}
			return values;
		}).flat();

	return finalValues;
}

function isLocation(obj: Location | Uri): obj is Location {
	return 'uri' in obj && 'range' in obj;
}
