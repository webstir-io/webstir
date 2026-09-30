type AttributeElement = Pick<
  Element,
  'attributes' | 'getAttribute' | 'hasAttribute' | 'removeAttribute' | 'setAttribute'
>;

/** The body attributes and class names a page's HTML gives it, as opposed to ones scripts add. */
export interface DeclaredBody {
  readonly attributes: ReadonlyMap<string, string>;
  readonly classes: ReadonlySet<string>;
}

export function readDeclaredBody(body: AttributeElement): DeclaredBody {
  return {
    attributes: new Map(
      Array.from(body.attributes, ({ name, value }) => [name, value] as const).filter(
        ([name]) => name !== 'class',
      ),
    ),
    classes: new Set(classNames(body)),
  };
}

/**
 * Changes the body where the incoming page's HTML differs from the outgoing page's, so a page
 * styled by its body looks as a full load of it would. Everything else stays as scripts left it
 * (a menu's open class, a theme a toggle set on an attribute both pages declare), since those
 * scripts do not run again. Returns what the incoming page declared, for the next navigation.
 */
export function syncBodyAttributes(
  current: AttributeElement,
  incoming: AttributeElement,
  outgoing: DeclaredBody,
): DeclaredBody {
  const declared = readDeclaredBody(incoming);
  for (const name of outgoing.attributes.keys()) {
    if (!declared.attributes.has(name)) current.removeAttribute(name);
  }
  for (const [name, value] of declared.attributes) {
    if (outgoing.attributes.get(name) !== value) current.setAttribute(name, value);
  }

  const leaving = [...outgoing.classes].filter((name) => !declared.classes.has(name));
  const arriving = [...declared.classes].filter((name) => !outgoing.classes.has(name));
  if (leaving.length > 0 || arriving.length > 0) {
    const kept = classNames(current).filter((name) => !leaving.includes(name));
    const classes = [...new Set([...kept, ...arriving])];
    if (classes.length > 0) current.setAttribute('class', classes.join(' '));
    else current.removeAttribute('class');
  }
  return declared;
}

function classNames(element: AttributeElement): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}
